/**
 * Tideline — a revenue chart line rendered as a luminous ocean tide.
 *
 * The technique is five transparent layers stacked on a dark navy stage,
 * all driven by one shared curve:
 *
 *  1. a seeded chart spline (centripetal Catmull-Rom, trough-clamped so it
 *     always reads as a plausible revenue chart — no dips below prior lows),
 *  2. a water body: an indexed grid mesh hanging below the spline, shaded
 *     with a teal depth gradient and vertical filament shimmer,
 *  3. a crest: two quad ribbons (soft halo + bright core) swept vertically
 *     off the spline — ribbons, never `linewidth`, which is capped at 1px
 *     on ANGLE/Windows — plus a mirrored glint band hanging under the crest,
 *  4. foam: additive point sprites (canvas-generated radial gradient) that
 *     rise off the crest, sparkle, and recycle.
 *
 * The crest undulation lives in GLSL as `crestOffset(t, time)` and is shared
 * verbatim by all shaders, so water, ribbon, and foam breathe together
 * without any CPU-side re-tessellation.
 *
 * Light and air (retrofit, calibrated against ThreeUI's tidecrest hero):
 *
 *  - Every shader writes **linear HDR**: the crest core and the foam sparkle
 *    run past 1.0 on purpose and let ACES compress them. Tone mapping and the
 *    sRGB conversion happen once, in the composer's `OutputPass`.
 *  - The recipe owns an `EffectComposer` (RenderPass → half-resolution
 *    UnrealBloomPass → OutputPass). Because three skips tone mapping when it
 *    renders into a render target, the HDR values reach the bloom intact and
 *    are only compressed at the very end — bloom on real highlights, not on
 *    a pre-clipped image.
 *  - One `uHaze` air tone is the colour the air itself glows. Water, grid,
 *    crest, and foam all lerp toward it by `(1.0 - vT)`, so depth and
 *    distance settle into a single atmosphere instead of fading to black.
 *  - Foam density is a *screen-space* constant (one particle per ~N canvas
 *    pixels), and point sizes and the crest core width are scaled by
 *    `uPixK = drawingBufferHeight / 720`, so weight and density read the same
 *    on a phone, a laptop, and a thumbnail.
 *
 * All stochastic placement runs through a seeded PRNG keyed by variant and
 * viewport size bucket, so thumbnails and reduced-motion still frames are
 * reproducible.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { createRng, hashSeed } from "../../engine/rng";
import type { PropValues, RecipeMeta, SceneContext } from "../../engine/types";

/* ------------------------------------------------------------------ *
 * LOOK — every tuned constant, with the reason it holds that value.
 * Nothing here is a user prop; these are the decisions the recipe makes
 * on the reader's behalf. Tuning happens here and nowhere else.
 * ------------------------------------------------------------------ */
const LOOK = {
  /** Air tone, linear. Deep navy-teal: the colour distance resolves into. */
  air: [0.011, 0.052, 0.094] as const,
  /** How far each layer lerps toward the air at full distance (0..1). */
  washWater: 0.86, // the deep body is mostly air by the time it reaches the floor
  washGrid: 0.88, // grid rows must dissolve into the air, not just lose alpha
  washCrest: 0.34, // the crest stays the subject: it only takes a hint of air
  washFoam: 0.42, // far foam belongs to the atmosphere, near foam to the tide
  /** Additive air glow on top of the wash — the air lighting itself. */
  airInWater: 0.5,
  airInGrid: 0.35,
  airInCrest: 0.16,
  airInFoam: 0.22,

  /** Water gradient, linear. Shallow rides just under the crest. */
  // Held under the crest core's brightness on purpose: when the curtain's top
  // edge is as bright as the line, the composition grows a second tideline.
  waterShallow: [0.10, 0.80, 0.74] as const,
  waterMid: [0.016, 0.36, 0.45] as const,
  waterDeep: [0.005, 0.10, 0.185] as const,
  /**
   * Falloff of the water body with depth. 0.62 (iteration 3) died about 40px
   * under the crest and left the ocean an empty black band; 0.42 gives the
   * body the long tail the composition is named after.
   */
  waterFalloff: 0.42,
  /**
   * The body is a backdrop, not the subject. Once the winding bug was fixed
   * and the curtain actually drew, 1.05 buried the crest, the foam and the
   * grid under a wall of teal.
   */
  waterAlpha: 0.42,
  /** Filament frequency across the curve, and how much of the body they carry. */
  waterStreakFreq: 420,
  waterStreakMix: 0.7,
  /**
   * Alpha the body keeps at the sea floor. Without it the rows (which are
   * eased toward the crest) *and* the falloff both vanish at depth, and the
   * ocean collapses into a thin band — the tide had no volume until this
   * floor existed.
   */
  waterDeepFloor: 0.1,
  /** The last stretch above the sea floor gives way to the air entirely. */
  waterFloorFade: 0.75,

  /** Crest halo: wide, teal, sub-1.0 — it is spread, not brightness. */
  crestHalo: [0.030, 0.52, 0.70] as const,
  /**
   * Crest core: HDR into ACES. Past 1.0 on purpose; the curve rolls it off.
   * Held down to ~2 because the line has to stay a filament — at 3.5 the core
   * plus its bloom fused into an opaque white rope (iteration 1).
   */
  crestCore: [1.95, 2.55, 2.4] as const,
  /**
   * Air backdrop: the sky glow that hugs the tideline. Every one of these
   * came down hard after iteration 2, where the air flooded the frame, ate
   * the headline quiet zone, and threw visible shafts above the crest peaks.
   * The air has to be felt, not seen.
   */
  airFloor: 0.1, // faintest air, top of frame — never fully black
  airGlow: 1.15, // multiplier on the air right at the waterline
  airRise: 0.7, // world units the glow reaches above the crest
  airFall: 0.95, // and below it, where it becomes the water's own depth
  /** Grid ink, linear. Low enough that bloom never picks the grid up. */
  gridInk: [0.030, 0.175, 0.20] as const,
  /** Foam tint multiplier — HDR so sparkle peaks bloom, bodies do not. */
  foamGain: 2.35,

  /** Half-resolution bloom: the affordable glow pass. */
  bloomScale: 0.5, // quarter of the pixels; the blur hides the resolution loss
  bloomStrength: 0.58, // enough for a crest core halo, short of a grid wash
  bloomRadius: 0.42, // tight: a wide radius smears the chart into a fog bank
  bloomThreshold: 0.72, // only HDR highlights qualify — grid and water stay crisp
  /**
   * MSAA samples on the composer target. Rendering into a target loses the
   * canvas' own antialias, so 4 was the obvious choice — and it turned out to
   * produce a *completely black frame* at some drawing-buffer sizes (480x300
   * and 720x450 reproduced every run; 600x375 and 960x600 were fine), which
   * would have shipped blank thumbnails. 8 failed the same way, 2 passed the
   * whole sweep. Zero is what actually earns its place: the crest is a soft
   * alpha-falloff ribbon and the bloom blur covers the rest, so the samples
   * were buying almost nothing against the risk of a blank hero.
   */
  msaa: 0,
  /** Tone curve exposure. 1.2 keeps the deep water readable under ACES. */
  exposure: 1.2,

  /**
   * Screen-uniform density: one foam particle per this many canvas pixels.
   * 320 is where the spray stops reading as countable objects (iteration 1
   * had it at 760 and the foam looked like scattered snowballs).
   */
  foamPxPerParticle: 240,
  foamMin: 420, // a 480x300 thumbnail still needs a legible sparkle band
  foamMax: 9000, // hard ceiling: a 5K display must not allocate its way to a stall
  /** Foam size distribution: few large, many small (the Sylva pow rule). */
  foamSizePow: 2.2,
  foamSizeMin: 0.26,
  foamSizeSpan: 1.15,

  /** Reference frame: sizes are authored for a 720px-tall canvas. */
  refHeight: 720,
  /** Floor on uPixK so a 300px-tall thumbnail keeps sub-pixel detail visible. */
  pixKMin: 0.55,
  /** Point size in reference pixels at unit distance-scale. */
  pointPx: 26,
  pointPxMax: 22, // spray, not hail: a mote that reads as a disc is too big

  /** Mirrored crest glints: the reflection trick, as geometry not raytracing. */
  glintDrop: 0.85, // world units the glint band hangs below the crest
  glintGain: 0.42, // dim: a reflection that competes with its source reads wrong
  glintFalloff: 3.4, // exponential fade down the band
  glintRipple: 0.55, // how much surface chop breaks the reflection up

  /** Rebuild pacing for the density recompute (see `syncSize`). */
  sizeBucketPx: 128, // geometric-mean quantum; smaller = more rebuilds
  rebuildMinMs: 240, // a drag resize must not rebuild the buffer every frame
} as const;

/* ------------------------------------------------------------------ *
 * Stage constants — the composition is authored in world units and the
 * camera is dollied each frame to fit them, so the framing (and the
 * left-hand headline quiet zone) survives any viewport aspect ratio.
 * ------------------------------------------------------------------ */
const X_MIN = -7.1;
const X_MAX = 7.1;
const Y_BOTTOM = -3.75;
const CENTER_Y = -0.2;
const FIT_WIDTH = 13.6;
const FIT_HEIGHT = 7.6;
const SAMPLES = 320;
const WATER_ROWS = 18;
const BACKGROUND = 0x030812;

interface Pt {
  x: number;
  y: number;
}

interface Tuning {
  months: number;
  endY: number;
  dip: number;
  jitter: number;
  speed: number;
  glow: number;
  /** Multiplier on the screen-uniform foam density, not an absolute count. */
  foamDensity: number;
  foamSpread: number;
  swell: number;
}

function tuningFor(variant: string): Tuning {
  switch (variant) {
    case "volatile":
      return {
        months: 14,
        endY: 2.4,
        dip: 0.42,
        jitter: 0.4,
        speed: 1.7,
        glow: 1.25,
        foamDensity: 1.15,
        foamSpread: 0.62,
        swell: 1.35,
      };
    case "calm":
      return {
        months: 9,
        endY: 1.35,
        dip: 0.13,
        jitter: 0.06,
        speed: 0.45,
        glow: 0.72,
        foamDensity: 0.7,
        foamSpread: 0.26,
        swell: 0.6,
      };
    default:
      return {
        months: 12,
        endY: 2.3,
        dip: 0.26,
        jitter: 0.16,
        speed: 1,
        glow: 1,
        foamDensity: 1,
        foamSpread: 0.4,
        swell: 1,
      };
  }
}

/* ------------------------------------------------------------------ *
 * Curve construction
 * ------------------------------------------------------------------ */

/** Trend line: mildly convex so growth accelerates toward the right. */
function trendAt(u: number, startY: number, endY: number): number {
  return startY + (endY - startY) * (0.34 * u + 0.66 * u * u);
}

/**
 * Alternating trough/peak control points. Troughs are forced to be
 * monotonically non-decreasing, which is what keeps the tide readable as a
 * revenue chart: a wave may crest and fall, but never below a previous low.
 */
function buildControlPoints(t: Tuning, rng: ReturnType<typeof createRng>) {
  const startY = -2.35;
  const points: Pt[] = [];
  const troughs: Pt[] = [];
  let floorY = -Infinity;

  for (let i = 0; i <= t.months; i++) {
    const u = i / t.months;
    const x = X_MIN + (X_MAX - X_MIN) * u;
    const base = trendAt(u, startY, t.endY);

    let troughY = base - t.dip * (0.55 + rng.next() * 0.6) + rng.signed(t.jitter);
    troughY = Math.max(troughY, floorY + 0.015);
    floorY = troughY;
    points.push({ x, y: troughY });
    troughs.push({ x, y: troughY });

    if (i === t.months) break;
    // Jitter the peak position so the wavelets never look metronomic.
    const up = u + (0.5 + rng.signed(0.16)) / t.months;
    points.push({
      x: X_MIN + (X_MAX - X_MIN) * up,
      y: trendAt(up, startY, t.endY) + t.dip * (0.7 + rng.next() * 0.7) + rng.signed(t.jitter * 0.6),
    });
  }
  return { points, troughs };
}

/** Drop NaN/Infinity and near-duplicate points before feeding the curve. */
function sanitize(points: Pt[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) < 1e-4 && Math.abs(prev.y - p.y) < 1e-4) continue;
    out.push(new THREE.Vector3(p.x, p.y, 0));
  }
  return out;
}

interface CurveData {
  xs: Float32Array;
  ys: Float32Array;
  months: Pt[];
}

function buildCurve(t: Tuning, rng: ReturnType<typeof createRng>): CurveData {
  const { points, troughs } = buildControlPoints(t, rng);
  const clean = sanitize(points);
  // Centripetal Catmull-Rom: no cusps, no overshoot loops on uneven spacing.
  const curve = new THREE.CatmullRomCurve3(clean, false, "centripetal");

  const xs = new Float32Array(SAMPLES);
  const ys = new Float32Array(SAMPLES);
  const tmp = new THREE.Vector3();

  // Running floor from the (already monotone) troughs, with a small margin
  // for the spline's natural undershoot between control points.
  const floorAt = (x: number): number => {
    let y = troughs[0].y;
    for (const tr of troughs) {
      if (tr.x > x) break;
      y = tr.y;
    }
    return y - 0.1;
  };

  for (let i = 0; i < SAMPLES; i++) {
    curve.getPoint(i / (SAMPLES - 1), tmp);
    let x = Number.isFinite(tmp.x) ? tmp.x : X_MIN;
    const y = Number.isFinite(tmp.y) ? tmp.y : 0;
    if (i > 0 && x <= xs[i - 1]) x = xs[i - 1] + 1e-3;
    xs[i] = THREE.MathUtils.clamp(x, X_MIN, X_MAX);
    ys[i] = Math.max(y, floorAt(x));
  }

  const months: Pt[] = troughs.map((p) => ({ x: p.x, y: p.y }));
  return { xs, ys, months };
}

/** Curve height at an arbitrary x (linear between samples). */
function heightAt(c: CurveData, x: number): number {
  if (x <= c.xs[0]) return c.ys[0];
  const last = SAMPLES - 1;
  if (x >= c.xs[last]) return c.ys[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c.xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const span = c.xs[hi] - c.xs[lo] || 1;
  const f = (x - c.xs[lo]) / span;
  return c.ys[lo] + (c.ys[hi] - c.ys[lo]) * f;
}

/* ------------------------------------------------------------------ *
 * Shared GLSL
 * ------------------------------------------------------------------ */

const NOISE_GLSL = /* glsl */ `
  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }
  float vnoise1(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i), hash11(i + 1.0), f);
  }
  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vnoise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  /**
   * Vertical crest displacement in world units for curve parameter t.
   * Damped on the left so the headline quiet zone stays calm.
   */
  float crestOffset(float t, float time, float swell) {
    float a = vnoise1(t * 6.5 + time * 0.35) - 0.5;
    float b = vnoise1(t * 17.0 - time * 0.24) - 0.5;
    float c = vnoise1(t * 31.0 + time * 0.5) - 0.5;
    float damp = 0.22 + 0.78 * t;
    return (a * 0.62 + b * 0.3 + c * 0.14) * swell * damp;
  }
`;

/**
 * Aerial perspective, one uniform for the whole scene. `vT` is how much of a
 * surface still reaches the eye (1 = right in front of you, 0 = lost to
 * distance or depth). What the surface loses, the air replaces with its own
 * glow — which is why far geometry settles into one colour instead of black.
 */
const AIR_GLSL = /* glsl */ `
  uniform vec3 uHaze;
  uniform float uAirIn;
  uniform float uWash;
  vec3 airWash(vec3 col, float vT) {
    float lost = clamp(1.0 - vT, 0.0, 1.0);
    return mix(col, uHaze, lost * uWash) + uHaze * uAirIn * lost;
  }
`;

/* ------------------------------------------------------------------ *
 * Layer builders
 * ------------------------------------------------------------------ */

interface Uniforms {
  uTime: { value: number };
  uSwell: { value: number };
  uGlow: { value: number };
  uFoam: { value: number };
  uGridOpacity: { value: number };
  uSprite: { value: THREE.Texture | null };
  /** The colour the air itself glows; every layer lerps toward it. */
  uHaze: { value: THREE.Color };
  /** drawingBufferHeight / 720 — the reference-frame scale for pixel sizes. */
  uPixK: { value: number };
}

type UniformMap = { [key: string]: THREE.IUniform };

/** Shared uniforms plus this layer's own air mix. */
function layerUniforms(u: Uniforms, airIn: number, wash: number, extra: UniformMap = {}): UniformMap {
  return {
    ...(u as unknown as UniformMap),
    uAirIn: { value: airIn },
    uWash: { value: wash },
    ...extra,
  };
}

function vec3(c: readonly [number, number, number]): string {
  return `vec3(${c[0].toFixed(4)}, ${c[1].toFixed(4)}, ${c[2].toFixed(4)})`;
}

/**
 * Air backdrop — the sky behind the tide, and the reason the empty upper-left
 * is not simply black. A two-row strip spanning the stage carries the crest
 * height per column as an attribute, so the glow hugs the rising tideline
 * instead of sitting in a flat horizontal band. This is the `uHaze` idea taken
 * literally: the air is a thing you can see, brightest where the water is.
 */
function buildAir(c: CurveData, u: Uniforms): THREE.Mesh {
  const cols = 96;
  const yLo = Y_BOTTOM - 3;
  const yHi = Y_BOTTOM + FIT_HEIGHT + 4;
  const xLo = X_MIN - 5;
  const xHi = X_MAX + 5;
  const pos = new Float32Array(cols * 2 * 3);
  const aCrest = new Float32Array(cols * 2);
  const index: number[] = [];

  for (let i = 0; i < cols; i++) {
    const x = xLo + ((xHi - xLo) * i) / (cols - 1);
    const crestY = heightAt(c, THREE.MathUtils.clamp(x, X_MIN, X_MAX));
    for (let j = 0; j < 2; j++) {
      const k = i * 2 + j;
      pos[k * 3] = x;
      pos[k * 3 + 1] = j === 0 ? yLo : yHi;
      pos[k * 3 + 2] = 0;
      aCrest[k] = crestY;
    }
    if (i < cols - 1) {
      const a = i * 2;
      index.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aCrest", new THREE.BufferAttribute(aCrest, 1));
  geometry.setIndex(index);

  const material = new THREE.ShaderMaterial({
    uniforms: layerUniforms(u, 0, 0),
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aCrest;
      varying float vAbove;
      varying float vX;
      void main() {
        vAbove = position.y - aCrest;
        vX = position.x;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uHaze;
      uniform float uGlow;
      varying float vAbove;
      varying float vX;
      void main() {
        // Asymmetric falloff: the air stacks up over the water and is cut
        // short below it, where the water body's own gradient takes over.
        float reach = vAbove >= 0.0 ? ${LOOK.airRise.toFixed(2)} : ${LOOK.airFall.toFixed(2)};
        float near = exp(-abs(vAbove) / reach);
        // Weighted hard to the right: the left third is the headline's, and
        // air is the first thing that would take it away.
        float lateral = 0.22 + 0.78 * smoothstep(${X_MIN.toFixed(1)}, ${X_MAX.toFixed(1)}, vX);
        float amount = ${LOOK.airFloor.toFixed(2)} * lateral + ${LOOK.airGlow.toFixed(2)} * near * lateral;
        gl_FragColor = vec4(uHaze * amount * (0.7 + 0.3 * uGlow), 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  return mesh;
}

function buildWater(c: CurveData, u: Uniforms): THREE.Mesh {
  const cols = SAMPLES;
  const rows = WATER_ROWS;
  const vertCount = cols * (rows + 1);
  const pos = new Float32Array(vertCount * 3);
  const aT = new Float32Array(vertCount);
  const aDepth = new Float32Array(vertCount);
  const index: number[] = [];

  for (let i = 0; i < cols; i++) {
    const t = i / (cols - 1);
    for (let j = 0; j <= rows; j++) {
      const d = j / rows;
      const k = i * (rows + 1) + j;
      // Bias rows toward the crest: detail where the gradient is strongest.
      const eased = d * d * 0.65 + d * 0.35;
      pos[k * 3] = c.xs[i];
      pos[k * 3 + 1] = c.ys[i] + (Y_BOTTOM - c.ys[i]) * eased;
      pos[k * 3 + 2] = 0;
      aT[k] = t;
      aDepth[k] = d;
    }
  }
  for (let i = 0; i < cols - 1; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j;
      const b = (i + 1) * (rows + 1) + j;
      // Counter-clockwise in screen space. The original winding here was
      // reversed, which meant every triangle of the water body was back-face
      // culled and the ocean never drew a single pixel — the glow under the
      // crest was the halo ribbon all along.
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
  geometry.setAttribute("aDepth", new THREE.BufferAttribute(aDepth, 1));
  geometry.setIndex(index);

  const material = new THREE.ShaderMaterial({
    uniforms: layerUniforms(u, LOOK.airInWater, LOOK.washWater),
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aT;
      attribute float aDepth;
      uniform float uTime;
      uniform float uSwell;
      varying float vT;
      varying float vDepth;
      varying float vTrans;
      ${NOISE_GLSL}
      void main() {
        vT = aT;
        vDepth = aDepth;
        // Transmittance: the right-hand tide is near and open, the left and
        // the deep body are seen through more air.
        vTrans = clamp((0.30 + 0.70 * aT) * (1.0 - 0.72 * aDepth), 0.0, 1.0);
        vec3 p = position;
        p.y += crestOffset(aT, uTime, uSwell) * (1.0 - smoothstep(0.0, 0.55, aDepth));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform float uGlow;
      varying float vT;
      varying float vDepth;
      varying float vTrans;
      ${NOISE_GLSL}
      ${AIR_GLSL}
      void main() {
        vec3 color = mix(${vec3(LOOK.waterShallow)}, ${vec3(LOOK.waterMid)}, smoothstep(0.0, 0.42, vDepth));
        color = mix(color, ${vec3(LOOK.waterDeep)}, smoothstep(0.4, 1.15, vDepth));
        color = airWash(color, vTrans);

        // Vertical filaments: the "hanging curtain" look under the crest.
        float streak = vnoise2(vec2(vT * ${LOOK.waterStreakFreq.toFixed(1)}, vDepth * 2.2 - uTime * 0.12));
        streak = mix(streak, vnoise2(vec2(vT * 148.0, vDepth * 1.1 + uTime * 0.07)), 0.5);
        streak = pow(streak, 1.35);

        float body = mix(${LOOK.waterDeepFloor.toFixed(2)}, 1.0, pow(1.0 - vDepth, ${LOOK.waterFalloff.toFixed(2)}));
        float alpha = body * (1.0 - ${LOOK.waterStreakMix.toFixed(2)} + ${LOOK.waterStreakMix.toFixed(2)} * streak) * ${LOOK.waterAlpha.toFixed(2)};
        alpha *= 1.0 - smoothstep(0.82, 1.0, vDepth) * ${LOOK.waterFloorFade.toFixed(2)};
        alpha *= 0.55 + 0.45 * vT;           // right side reads denser
        alpha *= 0.6 + 0.4 * uGlow;
        gl_FragColor = vec4(color * (0.75 + 0.5 * uGlow), alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

interface RibbonOptions {
  /** Half-height of the ribbon in world units at the reference frame. */
  width: number;
  /** Gaussian falloff exponent across the ribbon. */
  softness: number;
  /** Overall brightness multiplier. */
  gain: number;
  /** 0 = teal halo, 1 = HDR white core. */
  white: number;
  /**
   * 0 = the width is a world-space measure (the halo, which should stay a
   * fixed fraction of the composition); 1 = the width is pixel-locked to the
   * 720px reference frame, so the core line keeps its weight on every device.
   */
  pixLock: number;
  /** Mirror mode: hang a rippled, fading reflection band under the crest. */
  mirror?: boolean;
  renderOrder: number;
}

/**
 * Crest ribbon: two triangles per sample pair, expanded in the vertex
 * shader. Width is a uniform, so it can stay live, and the whole thing is
 * immune to the 1px `linewidth` cap of LineBasicMaterial.
 *
 * The same program also draws the mirrored glint: instead of straddling the
 * curve, the strip is remapped to hang below it, rippled and fading, which
 * buys a reflection for one extra draw call and no second render pass.
 */
function buildRibbon(c: CurveData, u: Uniforms, o: RibbonOptions): THREE.Mesh {
  const vertCount = SAMPLES * 2;
  const pos = new Float32Array(vertCount * 3);
  const aSide = new Float32Array(vertCount);
  const aT = new Float32Array(vertCount);
  const index: number[] = [];

  for (let i = 0; i < SAMPLES; i++) {
    const t = i / (SAMPLES - 1);
    for (let s = 0; s < 2; s++) {
      const k = i * 2 + s;
      pos[k * 3] = c.xs[i];
      pos[k * 3 + 1] = c.ys[i];
      pos[k * 3 + 2] = 0;
      aSide[k] = s === 0 ? -1 : 1;
      aT[k] = t;
    }
    if (i < SAMPLES - 1) {
      const a = i * 2;
      index.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1));
  geometry.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
  geometry.setIndex(index);

  const material = new THREE.ShaderMaterial({
    uniforms: layerUniforms(u, LOOK.airInCrest, LOOK.washCrest, {
      uWidth: { value: o.width },
      uSoftness: { value: o.softness },
      uGain: { value: o.gain },
      uWhite: { value: o.white },
      uPixLock: { value: o.pixLock },
      uMirror: { value: o.mirror ? 1 : 0 },
    }),
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSide;
      attribute float aT;
      uniform float uTime;
      uniform float uSwell;
      uniform float uWidth;
      uniform float uPixK;
      uniform float uPixLock;
      uniform float uMirror;
      varying float vSide;
      varying float vT;
      varying float vTrans;
      ${NOISE_GLSL}
      void main() {
        vSide = aSide;
        vT = aT;
        vTrans = 0.35 + 0.65 * aT;
        vec3 p = position;
        p.y += crestOffset(aT, uTime, uSwell);

        // A world-space width holds a constant share of the frame; a
        // pixel-locked width holds a constant number of pixels. The core
        // wants the second (a 2px line is a 2px line everywhere), so its
        // world width has to grow as the reference frame shrinks.
        float pk = max(uPixK, ${LOOK.pixKMin.toFixed(2)});
        float width = uWidth * mix(1.0, 1.0 / pk, uPixLock);

        // Offset vertically rather than along the curve normal: the chart is a
        // function graph, so a vertical sweep can never self-intersect at the
        // tight crest turns (normal offsets fan out into visible spikes there).
        float s01 = aSide * 0.5 + 0.5;
        float glintY = -${LOOK.glintDrop.toFixed(3)} * s01
          + (vnoise1(aT * 22.0 - uTime * 0.6) - 0.5) * 0.10 * s01;
        p.y += mix(aSide * width, glintY, uMirror);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform float uGlow;
      uniform float uSoftness;
      uniform float uGain;
      uniform float uWhite;
      uniform float uMirror;
      varying float vSide;
      varying float vT;
      varying float vTrans;
      ${NOISE_GLSL}
      ${AIR_GLSL}
      void main() {
        float d = abs(vSide);
        float core = exp(-d * d * uSoftness);
        vec3 color = mix(${vec3(LOOK.crestHalo)}, ${vec3(LOOK.crestCore)}, pow(core, 2.0) * uWhite);
        float alpha = core * uGain * (0.45 + 0.75 * vT) * uGlow;

        // Mirror mode: a band that falls away below the crest and is broken
        // up by surface chop, so it reads as a reflection rather than a copy.
        float s01 = vSide * 0.5 + 0.5;
        float chop = mix(1.0 - ${LOOK.glintRipple.toFixed(2)}, 1.0,
          vnoise2(vec2(vT * 120.0, uTime * 0.45 - s01 * 2.5)));
        float glint = exp(-s01 * ${LOOK.glintFalloff.toFixed(2)}) * chop
          * ${LOOK.glintGain.toFixed(3)} * (0.25 + 0.75 * vT) * uGlow;
        alpha = mix(alpha, glint, uMirror);

        color = airWash(color, mix(vTrans, vTrans * (1.0 - 0.55 * s01), uMirror));
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = o.renderOrder;
  return mesh;
}

/** 64px radial-gradient sprite, generated at runtime — zero assets. */
function makeFoamSprite(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // A tight core with a short tail. The generous gradient this started as
    // gave every mote a soft halo, and thousands of soft halos are fog.
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.16, "rgba(215,255,250,0.55)");
    g.addColorStop(0.45, "rgba(150,240,235,0.10)");
    g.addColorStop(1, "rgba(120,235,225,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  // sRGB texture on WebGL2 means the sampler hands the shader linear values,
  // which is what the rest of this recipe works in.
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Foam attributes for a given particle count. Separated from the material so
 * a viewport change can swap in a new geometry — density is a screen-space
 * constant here, so the count is a function of the canvas, not of the world.
 */
function foamGeometry(
  c: CurveData,
  t: Tuning,
  count: number,
  rng: ReturnType<typeof createRng>,
): THREE.BufferGeometry {
  const pos = new Float32Array(count * 3);
  const aT = new Float32Array(count);
  const aSeed = new Float32Array(count);
  const aPhase = new Float32Array(count);
  const aSize = new Float32Array(count);
  const aRise = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Bias density to the right, matching the growing tide.
    const p = Math.pow(rng.next(), 0.72);
    const idx = Math.min(SAMPLES - 1, Math.round(p * (SAMPLES - 1)));
    const lift = Math.pow(rng.next(), 2.0) * t.foamSpread * (0.4 + 1.1 * p);
    const below = rng.next() < 0.28 ? -0.55 : 1;
    pos[i * 3] = c.xs[idx] + rng.signed(0.05);
    pos[i * 3 + 1] = c.ys[idx] + lift * below;
    pos[i * 3 + 2] = 0;
    aT[i] = idx / (SAMPLES - 1);
    aSeed[i] = rng.next();
    aPhase[i] = rng.next();
    // pow-shaped: a few large motes carry the sparkle, the rest is spray.
    aSize[i] = LOOK.foamSizeMin + Math.pow(rng.next(), LOOK.foamSizePow) * LOOK.foamSizeSpan;
    aRise[i] = 0.4 + rng.next() * 1.2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(aPhase, 1));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1));
  geometry.setAttribute("aRise", new THREE.BufferAttribute(aRise, 1));
  return geometry;
}

function buildFoamMaterial(u: Uniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: layerUniforms(u, LOOK.airInFoam, LOOK.washFoam),
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aT;
      attribute float aSeed;
      attribute float aPhase;
      attribute float aSize;
      attribute float aRise;
      uniform float uTime;
      uniform float uSwell;
      uniform float uFoam;
      uniform float uPixK;
      varying float vAlpha;
      varying float vTrans;
      varying float vSparkle;
      ${NOISE_GLSL}
      void main() {
        vec3 p = position;
        p.y += crestOffset(aT, uTime, uSwell);

        // Rise-and-recycle: each particle lives one normalized lifetime.
        float life = fract(aPhase + uTime * 0.06 * aRise);
        p.y += life * 0.42 * (0.3 + aRise);
        p.x += sin(uTime * 0.6 + aPhase * 6.28318) * 0.04;

        float fade = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.45, 1.0, life));
        float sparkle = 0.55 + 0.45 * sin(uTime * 5.0 * aRise + aPhase * 32.0);
        float visible = step(aSeed, clamp(uFoam, 0.0, 1.0));

        vAlpha = fade * sparkle * visible * (0.55 + 0.45 * uFoam);
        vTrans = 0.45 + 0.55 * aT;
        // Only the peak of the sparkle earns HDR — a uniformly hot foam field
        // would bloom into a milky band across the whole crest.
        vSparkle = smoothstep(0.72, 1.0, sparkle) * aSize;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // Reference-frame sizing: authored against a 720px-tall canvas, so a
        // mote covers the same share of a phone screen and a 4K monitor.
        float pk = max(uPixK, ${LOOK.pixKMin.toFixed(2)});
        float sz = aSize * ${LOOK.pointPx.toFixed(1)} * pk / max(-mv.z, 0.001);
        gl_PointSize = clamp(sz, 1.0, ${LOOK.pointPxMax.toFixed(1)});
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uSprite;
      uniform float uGlow;
      varying float vAlpha;
      varying float vTrans;
      varying float vSparkle;
      ${AIR_GLSL}
      void main() {
        vec4 sprite = texture2D(uSprite, gl_PointCoord);
        float a = sprite.a * vAlpha * uGlow;
        if (a < 0.004) discard;
        // HDR into ACES: the sparkle peaks run past 1.0 so the bloom pass has
        // something real to catch, and the tone curve rolls them to white.
        vec3 col = sprite.rgb * (0.8 + 0.5 * uGlow) * ${LOOK.foamGain.toFixed(2)};
        col *= 1.0 + 1.35 * vSparkle;
        gl_FragColor = vec4(airWash(col, vTrans), a);
      }
    `,
  });
}

/**
 * Grid + axis ticks, also as quad ribbons. Vertical lines are clipped to the
 * water surface and horizontals only exist where the tide has risen past
 * them, so the empty upper-left stays uncluttered.
 */
function buildGrid(c: CurveData, u: Uniforms): THREE.Mesh {
  const pos: number[] = [];
  const fade: number[] = [];
  const index: number[] = [];
  const half = 0.008;

  const quad = (x0: number, y0: number, x1: number, y1: number, f0: number, f1: number) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len < 1e-4) return;
    const nxq = (-dy / len) * half;
    const nyq = (dx / len) * half;
    const base = pos.length / 3;
    pos.push(x0 - nxq, y0 - nyq, 0, x0 + nxq, y0 + nyq, 0, x1 - nxq, y1 - nyq, 0, x1 + nxq, y1 + nyq, 0);
    fade.push(f0, f0, f1, f1);
    index.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
  };

  // Vertical month lines, clipped to the water surface.
  for (const m of c.months) {
    const top = heightAt(c, m.x) - 0.05;
    if (top <= Y_BOTTOM + 0.6) continue;
    quad(m.x, Y_BOTTOM + 0.6, m.x, top, 0.25, 0.9);
    // Axis tick below the baseline.
    quad(m.x, Y_BOTTOM + 0.24, m.x, Y_BOTTOM + 0.38, 0.8, 0.8);
  }

  // Baseline axis.
  quad(X_MIN + 0.25, Y_BOTTOM + 0.45, X_MAX - 0.25, Y_BOTTOM + 0.45, 0.35, 0.85);

  // Horizontal value lines, only across the span where the tide covers them.
  for (let l = 1; l <= 6; l++) {
    const y = Y_BOTTOM + 0.75 + (l / 6) * 5.0;
    let startX: number | null = null;
    for (let i = 0; i < SAMPLES; i++) {
      const covered = c.ys[i] - 0.08 > y;
      if (covered && startX === null) startX = c.xs[i];
      if ((!covered || i === SAMPLES - 1) && startX !== null) {
        quad(startX, y, c.xs[i], y, 0.2, 0.85);
        startX = null;
      }
    }
    // Right-edge value tick.
    if (heightAt(c, X_MAX) - 0.08 > y) quad(X_MAX - 0.75, y, X_MAX - 0.45, y, 0.9, 0.9);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("aFade", new THREE.Float32BufferAttribute(fade, 1));
  geometry.setIndex(index);

  const material = new THREE.ShaderMaterial({
    uniforms: layerUniforms(u, LOOK.airInGrid, LOOK.washGrid),
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aFade;
      varying float vFade;
      varying float vX;
      void main() {
        vFade = aFade;
        vX = position.x;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uGridOpacity;
      varying float vFade;
      varying float vX;
      ${AIR_GLSL}
      void main() {
        float lateral = 0.35 + 0.65 * smoothstep(${X_MIN.toFixed(1)}, ${X_MAX.toFixed(1)}, vX);
        // Rows far from the eye wash into the air rather than merely losing
        // alpha: a faded line on black goes grey, an air-washed one goes navy.
        float trans = clamp(0.18 + 0.82 * lateral * vFade, 0.0, 1.0);
        vec3 ink = airWash(${vec3(LOOK.gridInk)}, trans);
        float a = vFade * lateral * uGridOpacity;
        gl_FragColor = vec4(ink, a);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

/* ------------------------------------------------------------------ *
 * Recipe
 * ------------------------------------------------------------------ */

const tideline: RecipeMeta = {
  slug: "tideline",
  title: "Tideline",
  category: "landing",
  description:
    "A landing-page hero where the revenue chart is the ocean: a seeded centripetal Catmull-Rom spline drives a shimmering water body, a quad-ribbon crest with mirrored glints, and a screen-uniform field of additive foam sprites. Shaders write linear HDR and a recipe-owned composer (half-resolution UnrealBloom, then ACES) does the compression, while one air-tone uniform washes depth and distance into a single atmosphere.",
  tags: ["landing", "hero", "shadermaterial", "particles", "bloom", "aces"],
  variants: [
    { id: "rising", label: "Rising" },
    { id: "volatile", label: "Volatile" },
    { id: "calm", label: "Calm" },
  ],
  props: [
    { key: "swell", label: "Swell", min: 0, max: 0.6, step: 0.01, default: 0.2 },
    { key: "foam", label: "Foam", min: 0, max: 1.4, step: 0.05, default: 1 },
    { key: "glow", label: "Glow", min: 0.2, max: 2, step: 0.05, default: 1 },
    { key: "speed", label: "Speed", min: 0, max: 3, step: 0.05, default: 1 },
    { key: "gridOpacity", label: "Grid", min: 0, max: 1, step: 0.02, default: 0.3 },
  ],
  /** Slow bloom: the foam needs a few seconds to spread before a still frame. */
  thumbnailWarmup: 3,
  /** Every shader here writes HDR; ACES is the curve those values assume. */
  rendering: { toneMapping: "aces", exposure: LOOK.exposure },

  create({ scene, camera, renderer, variant, props }: SceneContext) {
    const tuning = tuningFor(variant);
    const rng = createRng(hashSeed(`tideline:${variant}`));
    const curve = buildCurve(tuning, rng);

    scene.background = new THREE.Color(BACKGROUND);

    const sprite = makeFoamSprite();
    const uniforms: Uniforms = {
      uTime: { value: 0 },
      uSwell: { value: props.swell * tuning.swell },
      uGlow: { value: props.glow * tuning.glow },
      uFoam: { value: props.foam },
      uGridOpacity: { value: props.gridOpacity },
      uSprite: { value: sprite },
      uHaze: { value: new THREE.Color(...LOOK.air) },
      uPixK: { value: 1 },
    };

    /* ---- viewport-derived sizing ------------------------------------ *
     * Everything below reads the *drawing buffer*, never the CSS box: it
     * is the only measure that already includes device pixel ratio, and a
     * hidden or unlaid-out canvas reports 0, which would be fatal to a
     * render target. Clamp to 1 and carry on.
     * ----------------------------------------------------------------- */
    const bufferSize = new THREE.Vector2();
    function drawingBuffer(): { w: number; h: number } {
      renderer.getDrawingBufferSize(bufferSize);
      return {
        w: Math.max(1, Math.floor(bufferSize.x)),
        h: Math.max(1, Math.floor(bufferSize.y)),
      };
    }

    /**
     * Quantize the canvas to a size bucket. The bucket is both the debounce
     * (a drag across a bucket edge rebuilds once, not every frame) and the
     * determinism key: the same variant at the same bucket always produces
     * the same foam, so thumbnails are reproducible.
     */
    function bucketOf(w: number, h: number): number {
      return Math.max(1, Math.round(Math.sqrt(w * h) / LOOK.sizeBucketPx));
    }

    /** Screen-uniform density: one particle per `foamPxPerParticle` pixels. */
    function foamCountFor(bucket: number): number {
      const px = Math.pow(bucket * LOOK.sizeBucketPx, 2);
      const raw = (px / LOOK.foamPxPerParticle) * tuning.foamDensity;
      return THREE.MathUtils.clamp(Math.round(raw), LOOK.foamMin, LOOK.foamMax);
    }

    let foamBucket = bucketOf(drawingBuffer().w, drawingBuffer().h);
    const foam = new THREE.Points(
      foamGeometry(
        curve,
        tuning,
        foamCountFor(foamBucket),
        createRng(hashSeed(`tideline:foam:${variant}:${foamBucket}`)),
      ),
      buildFoamMaterial(uniforms),
    );
    foam.frustumCulled = false;
    foam.renderOrder = 6;

    // Draw order: air → water body → mirrored glint → grid → crest halo/core → foam.
    const air = buildAir(curve, uniforms);
    const water = buildWater(curve, uniforms);
    const glint = buildRibbon(curve, uniforms, {
      width: 0,
      softness: 0,
      gain: 0,
      white: 0,
      pixLock: 0,
      mirror: true,
      renderOrder: 2,
    });
    const grid = buildGrid(curve, uniforms);
    const halo = buildRibbon(curve, uniforms, {
      width: 0.46,
      softness: 3.2,
      gain: 0.34,
      white: 0,
      pixLock: 0,
      renderOrder: 4,
    });
    const core = buildRibbon(curve, uniforms, {
      width: 0.016,
      softness: 9.5,
      gain: 1.05,
      white: 1,
      pixLock: 1,
      renderOrder: 5,
    });
    scene.add(air, water, glint, grid, halo, core, foam);

    /* ---- post chain -------------------------------------------------- *
     * RenderPass into a half-float target (so HDR survives) → half-
     * resolution bloom → OutputPass, which is where ACES and the sRGB
     * conversion finally happen. Rendering into a target is exactly why the
     * HDR reaches the bloom: three only tone-maps when it draws to the
     * default framebuffer.
     * ------------------------------------------------------------------ */
    const first = drawingBuffer();
    const target = new THREE.WebGLRenderTarget(first.w, first.h, {
      // Half-float is the whole point: it is what lets the shaders' HDR values
      // reach the bloom pass instead of clipping at 1.0 on the way in.
      type: THREE.HalfFloatType,
      samples: LOOK.msaa,
    });
    const composer = new EffectComposer(renderer, target);
    // We size the composer in drawing-buffer pixels, which already include
    // DPR; leaving the composer's own ratio at the renderer's would square it.
    composer.setPixelRatio(1);
    const renderPass = new RenderPass(scene, camera);
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(first.w, first.h),
      LOOK.bloomStrength,
      LOOK.bloomRadius,
      LOOK.bloomThreshold,
    );
    const outputPass = new OutputPass();
    composer.addPass(renderPass);
    composer.addPass(bloom);
    composer.addPass(outputPass);

    let sizeW = 0;
    let sizeH = 0;
    let lastFoamBuild = 0;
    /** The first size the harness reports is a mount, not a resize: no wait. */
    let mounting = true;

    function syncSize(): void {
      const { w, h } = drawingBuffer();
      if (w !== sizeW || h !== sizeH) {
        sizeW = w;
        sizeH = h;
        composer.setSize(w, h);
        // setSize resizes every pass, so the half-resolution bloom has to be
        // re-stated afterwards or it silently goes back to full resolution.
        bloom.setSize(
          Math.max(1, Math.floor(w * LOOK.bloomScale)),
          Math.max(1, Math.floor(h * LOOK.bloomScale)),
        );
        uniforms.uPixK.value = h / LOOK.refHeight;
      }
      const bucket = bucketOf(w, h);
      if (bucket === foamBucket) return;
      const now = performance.now();
      if (!mounting && now - lastFoamBuild < LOOK.rebuildMinMs) return;
      foamBucket = bucket;
      lastFoamBuild = now;
      mounting = false;
      // A fresh geometry rather than swapped attributes: replacing attributes
      // in place orphans their GL buffers until the geometry itself is freed.
      foam.geometry.dispose();
      foam.geometry = foamGeometry(
        curve,
        tuning,
        foamCountFor(bucket),
        createRng(hashSeed(`tideline:foam:${variant}:${bucket}`)),
      );
    }
    syncSize();

    /** Dolly the camera so the authored composition fits any aspect ratio. */
    function fitCamera(): void {
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const aspect = camera.aspect > 0.01 ? camera.aspect : 1;
      // "Cover" fit: the tighter of the two distances, so the hero always
      // fills the frame and the geometry edges stay outside the viewport.
      const z = Math.min(FIT_HEIGHT / 2 / tanHalf, FIT_WIDTH / 2 / (tanHalf * aspect));
      camera.position.set(0, CENTER_Y, z);
      camera.lookAt(0, CENTER_Y, 0);
      camera.updateProjectionMatrix();
    }
    fitCamera();

    let speed = props.speed * tuning.speed;

    return {
      update(_elapsed: number, dt: number) {
        fitCamera();
        uniforms.uTime.value += dt * speed;
      },
      render() {
        // Sizing lives here, not in a resize listener: the drawing buffer is
        // the authority, and it also moves when the DPR changes under a
        // window that never fired a resize event.
        syncSize();
        composer.render();
      },
      applyProps(next: PropValues) {
        uniforms.uSwell.value = next.swell * tuning.swell;
        uniforms.uGlow.value = next.glow * tuning.glow;
        uniforms.uFoam.value = next.foam;
        uniforms.uGridOpacity.value = next.gridOpacity;
        speed = next.speed * tuning.speed;
        return true;
      },
      dispose() {
        // The composer owns render targets the harness' scene-graph walk can
        // never reach, and UnrealBloomPass alone holds a dozen of them.
        composer.dispose();
        renderPass.dispose();
        bloom.dispose();
        outputPass.dispose();
        // Uniform textures are not reachable by the harness' graph walk.
        sprite.dispose();
        scene.background = null;
      },
    };
  },
};

export default tideline;
