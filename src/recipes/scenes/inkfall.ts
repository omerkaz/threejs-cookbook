/**
 * Inkfall — sumi ink blooming underwater over warm paper.
 *
 * This is the cookbook's only render-target recipe. Everything you see is one
 * scalar density field living in a ping-pong pair of half-resolution targets
 * (`engine/feedback.ts`), plus one full-viewport quad that colours it:
 *
 *  1. ~1.7k CPU particles are advected by curl noise derived from `fbm2`.
 *     They are never drawn as geometry — each frame their positions are
 *     uploaded to the feedback buffer's splat `THREE.Points` (ONE draw call)
 *     and stamped additively into the field.
 *  2. The field decays ~0.5% per frame and diffuses slightly while drifting
 *     upward, which is what turns a few thousand discrete dots into
 *     continuous tendrils with soft, feathered edges.
 *  3. A single opaque quad samples the field and maps density through a ramp:
 *     paper → warm sepia edge → near-black core, with procedural paper grain
 *     mixed in the SAME shader. The composite is opaque on purpose — blending
 *     ink over `scene.background` would put a premultiplied-alpha fringe
 *     around every tendril.
 *
 * The field is DENSITY, never colour: the targets and the splat sprite are
 * `NoColorSpace`, and all paper/ink colour exists only in the composite
 * shader. That is also why the recipe reads well in all three variants
 * without touching the simulation.
 *
 * Composition: ink is emitted in the right ~55% and the composite gates
 * density to zero left of x ≈ 0.46, so the headline zone stays clean paper
 * no matter how the plume wanders.
 *
 * Warm-up interplay: `create()` runs 90 synchronous steps at a fixed dt so the
 * very first visible frame — live, thumbnail, or reduced-motion still — is an
 * already-developed bloom. `thumbnailWarmup` is therefore LOW (0.5s ≈ 23
 * extra steps): the thumbnailer only needs to nudge the bloom, not grow it.
 * Both paths are deterministic (seeded RNG, fixed dt, no wall clock in the
 * simulation), so the thumbnail is reproducible.
 */
import * as THREE from "three";
import { FeedbackBuffer } from "../../engine/feedback";
import { fbm2 } from "../../engine/noise";
import { createRng, hashSeed } from "../../engine/rng";
import type { PropValues, RecipeMeta, SceneContext } from "../../engine/types";

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

const PARTICLES = 1500;
/** Steps run at create() so the first visible frame is a developed bloom. */
const PREWARM_STEPS = 90;
/** Shorter re-warm after a resize or a context restore. */
const REWARM_STEPS = 45;
const FIXED_DT = 1 / 45;
/** Curl is re-sampled every Nth step per particle — the field is smooth. */
const CURL_STRIDE = 6;
/** Debounce window for viewport resizes, ms: window drags must not thrash. */
const RESIZE_DEBOUNCE = 150;
/** Upward drift of the whole field, UV per second at flow = 1. */
const RISE = 0.03;
/** Ink is gated out left of here (UV x) — the headline lives there. */
const GATE_START = 0.36;
const GATE_END = 0.5;
const CAMERA_Z = 8;

interface Palette {
  paper: THREE.Color;
  /** Paper tint in the darker mottled areas of the grain. */
  paperShade: THREE.Color;
  /** Thin-tendril colour, where the ink is barely there. */
  edge: THREE.Color;
  /** Dense-core colour. */
  core: THREE.Color;
}

interface Tuning {
  palette: Palette;
  /** Curl amplitude — how much the tendrils writhe. */
  curl: number;
  /** Buoyancy, UV units per second². */
  buoyancy: number;
  /** Spatial frequency of the curl field. */
  scale: number;
  /** Base splat radius, in units of the buffer's short edge. */
  splat: number;
  /** Seconds per emission cycle. */
  period: number;
}

function tuningFor(variant: string): Tuning {
  switch (variant) {
    case "indigo":
      return {
        palette: {
          paper: new THREE.Color(0xe9e6dd),
          paperShade: new THREE.Color(0xd3d2cd),
          edge: new THREE.Color(0x5b6b86),
          core: new THREE.Color(0x121a2c),
        },
        curl: 0.82,
        buoyancy: 0.46,
        scale: 6.2,
        splat: 0.012,
        period: 10.5,
      };
    case "vermilion":
      return {
        palette: {
          paper: new THREE.Color(0xf3e7d5),
          paperShade: new THREE.Color(0xdfcdb4),
          edge: new THREE.Color(0xa8613a),
          core: new THREE.Color(0x51160e),
        },
        curl: 0.98,
        buoyancy: 0.56,
        scale: 7.4,
        splat: 0.011,
        period: 8.5,
      };
    default:
      return {
        palette: {
          paper: new THREE.Color(0xece5d8),
          paperShade: new THREE.Color(0xd8cfbe),
          edge: new THREE.Color(0x6e6353),
          core: new THREE.Color(0x14120f),
        },
        curl: 0.9,
        buoyancy: 0.5,
        scale: 6.8,
        splat: 0.012,
        period: 9.5,
      };
  }
}

/* ------------------------------------------------------------------ *
 * Deterministic per-respawn randomness
 *
 * Particles respawn thousands of times over a session; drawing from the
 * build-time RNG stream would make the sequence depend on how many frames
 * have been rendered (and thus differ between the live view and a thumbnail).
 * Hashing (index, respawn count, salt) instead is stateless and reproducible.
 * ------------------------------------------------------------------ */

function hash01(a: number, b: number, salt: number): number {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(b + 0xc2b2ae35, 0x27d4eb2f);
  h ^= Math.imul(salt + 0x165667b1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ *
 * Curl noise
 *
 * The stream function is `fbm2`; its curl is divergence-free, which is what
 * makes the flow read as a liquid rather than as particles blown by wind.
 * Forward differences (3 samples) instead of central (4): at this noise
 * frequency the asymmetry is invisible and it is 25% cheaper.
 * ------------------------------------------------------------------ */

const CURL_EPS = 0.012;

function curlAt(x: number, y: number, t: number, scale: number, out: { x: number; y: number }): void {
  const sx = x * scale + t * 0.03;
  const sy = y * scale - t * 0.07;
  const p = fbm2(sx, sy, 2);
  const px = fbm2(sx + CURL_EPS, sy, 2);
  const py = fbm2(sx, sy + CURL_EPS, 2);
  out.x = (py - p) / CURL_EPS;
  out.y = -(px - p) / CURL_EPS;
}

/**
 * Decay prop → per-frame survival multiplier. Both ends are bounded on
 * purpose: 0.9965 is a ~3.3s half-life, slow enough for long veils but still
 * short enough that a 25s run does not silt up into one black mass, and
 * 0.985 (~0.8s) clears the field fast without erasing the tendrils.
 */
function decayFor(prop: number): number {
  return 0.9965 - 0.0075 * THREE.MathUtils.clamp(prop, 0, 1);
}

/* ------------------------------------------------------------------ *
 * Composite shader — the only place ink has a colour
 * ------------------------------------------------------------------ */

const COMPOSITE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const COMPOSITE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uInk;
  uniform vec3 uPaper;
  uniform vec3 uPaperShade;
  uniform vec3 uEdge;
  uniform vec3 uCore;
  uniform float uGrain;
  uniform float uGain;
  uniform float uAspect;
  varying vec2 vUv;

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    // Aspect-corrected sampling coordinates keep grain and fibre isotropic.
    vec2 gp = vec2(vUv.x * uAspect, vUv.y);

    // Paper: a broad mottle, a fibre streak, and fine tooth.
    float mottle = vnoise(gp * 3.5);
    float fibre = vnoise(gp * vec2(220.0, 12.0));
    float tooth = hash21(floor(gp * 900.0));
    float paperMix = clamp(mottle * 0.75 + fibre * 0.25, 0.0, 1.0);
    vec3 paper = mix(uPaper, uPaperShade, paperMix * uGrain * 0.85);
    paper *= 1.0 - (tooth - 0.5) * uGrain * 0.11;

    // Density → ink. Gated left of the headline zone; the gate is in the
    // composite (not just the emitter) so a stray tendril can never reach it.
    float d = texture2D(uInk, vUv).r * uGain;
    d *= smoothstep(${GATE_START.toFixed(2)}, ${GATE_END.toFixed(2)}, vUv.x);

    // Paper tooth bites into thin ink the way real sumi does.
    d *= 1.0 - (tooth - 0.5) * 0.28;

    float wash = smoothstep(0.02, 0.42, d);
    float body = smoothstep(0.5, 1.6, d);
    vec3 color = mix(paper, uEdge, wash);
    color = mix(color, uCore, body);

    gl_FragColor = vec4(color, 1.0);
  }
`;

/* ------------------------------------------------------------------ *
 * Recipe
 * ------------------------------------------------------------------ */

interface Site {
  x: number;
  y: number;
  radius: number;
  /** Cycle offset in [0, 1). */
  phase: number;
  /** Cycle length multiplier. */
  rate: number;
  drift: number;
}

const inkfall: RecipeMeta = {
  slug: "inkfall",
  title: "Inkfall",
  category: "landing",
  description:
    "A landing-page hero where black sumi ink blooms underwater over warm paper. Curl-noise particles are splatted into a ping-pong feedback buffer as a single Points draw call; the field decays, diffuses and drifts upward, and one opaque quad maps that density through a paper → sepia → near-black ramp with procedural grain. Light-mode editorial mood with a clean left headline zone.",
  tags: ["landing", "hero", "feedback", "render-target", "particles", "shadermaterial"],
  variants: [
    { id: "sumi", label: "Sumi" },
    { id: "indigo", label: "Indigo" },
    { id: "vermilion", label: "Vermilion" },
  ],
  props: [
    { key: "flow", label: "Flow", min: 0, max: 2.5, step: 0.05, default: 1 },
    { key: "density", label: "Density", min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { key: "decay", label: "Decay", min: 0, max: 1, step: 0.02, default: 0.22 },
    { key: "drops", label: "Drops", min: 1, max: 6, step: 1, default: 4, rebuild: true },
    { key: "grain", label: "Grain", min: 0, max: 1.5, step: 0.05, default: 0.7 },
  ],
  /**
   * Deliberately low: the create-time pre-warm has already grown the bloom,
   * so the thumbnailer only advances it half a second (~23 steps) to catch
   * the tendrils mid-drift rather than growing them from nothing.
   */
  thumbnailWarmup: 0.5,

  create({ scene, camera, renderer, variant, props }: SceneContext) {
    const tuning = tuningFor(variant);
    const rng = createRng(hashSeed(`inkfall:${variant}`));

    scene.background = tuning.palette.paper.clone();

    /* ---- feedback field ---------------------------------------- */
    const field = new FeedbackBuffer(renderer, {
      count: PARTICLES,
      decay: decayFor(props.decay),
      rise: RISE * props.flow,
      swirl: 0.02,
      resolutionScale: 0.5,
      density: props.density,
    });

    /* ---- emission sites ---------------------------------------- */
    const dropCount = Math.max(1, Math.round(props.drops));
    const sites: Site[] = [];
    for (let i = 0; i < dropCount; i++) {
      // Sites live in the right-hand third and sit at (or just below) the
      // bottom edge, so every bloom rises into frame with its base cropped —
      // the plume reads as continuing past the canvas, as in the art target.
      const spread = dropCount === 1 ? 0.5 : i / (dropCount - 1);
      sites.push({
        x: 0.6 + spread * 0.36 + rng.signed(0.03),
        y: -0.03 + rng.next() * 0.12,
        radius: 0.02 + rng.next() * 0.03,
        phase: i / dropCount + rng.signed(0.06),
        rate: 0.85 + rng.next() * 0.35,
        drift: rng.signed(0.02),
      });
    }

    /* ---- particle state ---------------------------------------- */
    const px = new Float32Array(PARTICLES);
    const py = new Float32Array(PARTICLES);
    const vx = new Float32Array(PARTICLES);
    const vy = new Float32Array(PARTICLES);
    const cx = new Float32Array(PARTICLES);
    const cy = new Float32Array(PARTICLES);
    const age = new Float32Array(PARTICLES);
    const life = new Float32Array(PARTICLES);
    const born = new Float32Array(PARTICLES); // strength envelope at spawn
    const size = new Float32Array(PARTICLES);
    /** Per-particle responsiveness — identical particles would move as a blob. */
    const agility = new Float32Array(PARTICLES);
    /** Fixed offset into the curl field, so neighbours never sample in lockstep. */
    const offx = new Float32Array(PARTICLES);
    const offy = new Float32Array(PARTICLES);
    const respawns = new Uint32Array(PARTICLES);
    const siteOf = new Uint8Array(PARTICLES);
    for (let i = 0; i < PARTICLES; i++) siteOf[i] = i % dropCount;

    let simTime = 0;
    let flow = props.flow;
    const curl = { x: 0, y: 0 };


    /** Emission envelope of a site: pump, then rest while the ink dissipates. */
    function envelope(site: Site): number {
      const u = (((simTime * site.rate) / tuning.period + site.phase) % 1 + 1) % 1;
      return smooth01(u, 0.0, 0.05) * (1 - smooth01(u, 0.28, 0.55));
    }

    function smooth01(x: number, a: number, b: number): number {
      const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    }

    /** Where a site's mouth sits right now — it rises across its cycle. */
    function mouth(site: Site, out: { x: number; y: number }): void {
      const u = (((simTime * site.rate) / tuning.period + site.phase) % 1 + 1) % 1;
      out.x = site.x + site.drift * u * 6;
      out.y = site.y + u * 0.16;
    }

    const mouthAt = { x: 0, y: 0 };

    function spawn(i: number): void {
      const site = sites[siteOf[i]];
      const n = respawns[i];
      mouth(site, mouthAt);
      const a = hash01(i, n, 1);
      const r = hash01(i, n, 2);
      const theta = a * Math.PI * 2;
      const radius = Math.sqrt(r) * site.radius;
      px[i] = mouthAt.x + Math.cos(theta) * radius;
      py[i] = mouthAt.y + Math.sin(theta) * radius * 0.7;
      vx[i] = (hash01(i, n, 3) - 0.5) * 0.12;
      vy[i] = 0.05 + hash01(i, n, 4) * 0.14;
      age[i] = 0;
      life[i] = 3 + hash01(i, n, 5) * 5;
      size[i] = tuning.splat * (0.5 + hash01(i, n, 6) * 1.2);
      agility[i] = 0.45 + hash01(i, n, 7) * 1.5;
      offx[i] = (hash01(i, n, 8) - 0.5) * 0.12;
      offy[i] = (hash01(i, n, 9) - 0.5) * 0.12;
      born[i] = 0.45 + envelope(site) * 0.9;
      respawns[i] = n + 1;
    }

    // Stagger the initial ages so the first steps do not emit one hard pulse.
    for (let i = 0; i < PARTICLES; i++) {
      spawn(i);
      age[i] = rng.next() * life[i];
    }

    /** One simulation step: advect particles, upload splats, step the field. */
    function simulate(dt: number): void {
      const step = Math.min(Math.max(dt, 0), FIXED_DT * 2);
      simTime += step;
      const speed = flow;
      const positions = field.positions;
      const sizes = field.sizes;
      const strengths = field.strengths;
      const stridePhase = Math.floor(simTime / FIXED_DT) % CURL_STRIDE;

      for (let i = 0; i < PARTICLES; i++) {
        age[i] += step * speed;
        if (age[i] >= life[i]) spawn(i);

        if (i % CURL_STRIDE === stridePhase) {
          curlAt(px[i] + offx[i], py[i] + offy[i], simTime, tuning.scale, curl);
          cx[i] = curl.x;
          cy[i] = curl.y;
        }

        const t = age[i] / life[i];
        // Buoyancy fades as the ink loses momentum and spreads sideways.
        const lift = tuning.buoyancy * (1 - t * 0.75);
        const agile = agility[i];
        vx[i] += cx[i] * tuning.curl * agile * step * speed;
        vy[i] += (cy[i] * tuning.curl * agile + lift * agile) * step * speed;
        // Viscous drag — ink in water settles quickly.
        const drag = Math.exp(-1.1 * agile * step * speed);
        vx[i] *= drag;
        vy[i] *= drag;
        px[i] += vx[i] * step * speed;
        py[i] += vy[i] * step * speed;

        // Soft wall in front of the headline zone: nudge, never teleport.
        if (px[i] < GATE_END) {
          const push = (GATE_END - px[i]) * 0.9;
          vx[i] += push * step * speed;
        }

        const fade = smooth01(t, 0, 0.08) * (1 - smooth01(t, 0.45, 1));
        positions[i * 3] = px[i] * 2 - 1;
        positions[i * 3 + 1] = py[i] * 2 - 1;
        positions[i * 3 + 2] = 0;
        sizes[i] = size[i];
        strengths[i] = born[i] * fade * 0.012;
      }

      field.markSplatsDirty();
      field.step(step);
    }

    /* ---- composite quad ---------------------------------------- */
    const uniforms = {
      uInk: { value: field.texture },
      uPaper: { value: tuning.palette.paper.clone() },
      uPaperShade: { value: tuning.palette.paperShade.clone() },
      uEdge: { value: tuning.palette.edge.clone() },
      uCore: { value: tuning.palette.core.clone() },
      uGrain: { value: props.grain },
      uGain: { value: 1 },
      uAspect: { value: 1 },
    };

    const quadGeometry = new THREE.PlaneGeometry(1, 1);
    const quadMaterial = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: COMPOSITE_VERT,
      fragmentShader: COMPOSITE_FRAG,
      // Opaque composite: ink over paper happens inside the shader, so there
      // is no alpha fringe and no draw-order dependency.
      transparent: false,
      depthWrite: true,
    });
    const quad = new THREE.Mesh(quadGeometry, quadMaterial);
    quad.frustumCulled = false;
    scene.add(quad);

    /** Scale the quad so it exactly covers the frustum at z = 0. */
    function fitQuad(): void {
      const aspect = camera.aspect > 0.01 ? camera.aspect : 1;
      const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * CAMERA_Z;
      quad.scale.set(height * aspect, height, 1);
      uniforms.uAspect.value = aspect;
    }

    camera.position.set(0, 0, CAMERA_Z);
    camera.lookAt(0, 0, 0);
    fitQuad();

    /* ---- pre-warm: the first visible frame is already a bloom ---- */
    for (let i = 0; i < PREWARM_STEPS; i++) simulate(FIXED_DT);
    uniforms.uInk.value = field.texture;

    function rewarm(steps: number): void {
      for (let i = 0; i < steps; i++) simulate(FIXED_DT);
      uniforms.uInk.value = field.texture;
    }

    /* ---- resize (debounced) + context restore ------------------- */
    const bufferSize = new THREE.Vector2();
    renderer.getDrawingBufferSize(bufferSize);
    let lastW = bufferSize.x;
    let lastH = bufferSize.y;
    let resizeAt = 0;

    function pollResize(): void {
      renderer.getDrawingBufferSize(bufferSize);
      if (bufferSize.x === 0 || bufferSize.y === 0) return; // hidden container
      if (bufferSize.x !== lastW || bufferSize.y !== lastH) {
        lastW = bufferSize.x;
        lastH = bufferSize.y;
        // Reallocating on every drag frame would thrash targets and re-warms.
        resizeAt = performance.now() + RESIZE_DEBOUNCE;
        return;
      }
      if (resizeAt === 0 || performance.now() < resizeAt) return;
      resizeAt = 0;
      if (field.resize()) rewarm(REWARM_STEPS);
    }

    const canvas = renderer.domElement;
    const onRestored = (): void => {
      // The GPU dropped both targets; rebuild and re-grow the bloom, or the
      // hero comes back as blank paper. A restore is rare and user-visible,
      // so it pays the full pre-warm rather than the short resize one.
      field.rebuild();
      rewarm(PREWARM_STEPS);
    };
    canvas.addEventListener("webglcontextrestored", onRestored);

    return {
      update() {
        fitQuad();
      },
      preRender(dt: number) {
        pollResize();
        simulate(dt);
        // The buffer swapped: point the composite at the new front texture.
        uniforms.uInk.value = field.texture;
      },
      applyProps(next: PropValues) {
        if (Math.round(next.drops) !== dropCount) return false;
        flow = next.flow;
        field.density = next.density;
        field.decay = decayFor(next.decay);
        field.rise = RISE * next.flow;
        uniforms.uGrain.value = next.grain;
        return true;
      },
      dispose() {
        canvas.removeEventListener("webglcontextrestored", onRestored);
        field.dispose();
        quadGeometry.dispose();
        quadMaterial.dispose();
        scene.background = null;
      },
    };
  },
};

export default inkfall;
