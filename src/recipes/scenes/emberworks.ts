/**
 * Emberworks — a molten metal pour in a dark forge.
 *
 * A stylized interpretation, not a photoreal one: the mood is carried by an
 * emissive ribbon, a spray of ballistic sparks and a breath of warm smoke,
 * all additive on near-black. There is no postprocessing of any kind — no
 * `EffectComposer`, no render targets, no bloom, and deliberately **no
 * screen-space heat haze**, which would need a render-to-texture distortion
 * pass. What shimmer there is happens where it is cheap and honest: a
 * noise-driven wobble applied to the pour's spine in the *vertex* shader,
 * and UV-space flow noise inside the pour's own fragment shader.
 *
 *  1. the pour: two camera-facing ribbons swept along one authored spine —
 *     a wide, dim halo behind a narrow, white-hot core. `TubeGeometry` was
 *     rejected on purpose: it is static, and animating a pour by rebuilding
 *     a tube every frame throws away a buffer per frame. **Deformation
 *     strategy (a): the spine is fixed on the CPU and displaced in the
 *     vertex shader** by value noise, so the ribbon writhes for the cost of
 *     two noise samples per vertex. Halo and core share one wobble function
 *     and one set of uniforms, so they can never drift apart,
 *  2. the impact pool: an additive radial-gradient quad with a slow pulse,
 *     plus a stretched runoff copy spreading along the anvil top,
 *  3. sparks: 1.2k additive quad billboards, each one a closed-form ballistic
 *     — `p = origin + v·t + ½g·t²` evaluated in the vertex shader from a
 *     wrapped lifetime. Nothing is integrated on the CPU, so a single
 *     `update(warmup, warmup)` call composes the whole spray exactly as the
 *     live scene would after that many seconds. Each quad is stretched along
 *     its own screen-space velocity, giving motion streaks,
 *  4. smoke: 9 large, very-low-alpha billboards drifting up through the heat,
 *  5. silhouettes: a crucible wedge at the top-right and dark anvil blocks at
 *     the bottom, lit *only* by the pour — a single dim orange `PointLight`
 *     at the pool fakes the bounce. There is no other light in the scene.
 *
 * **Transparency ordering.** Everything glowing is additive and writes no
 * depth, so draw order is authored explicitly rather than left to three.js'
 * distance sort: silhouettes (opaque, renderOrder 0) → smoke (5) → pool glow
 * (8) → ribbon halo (10) → ribbon core (12) → sparks (20). Back to front,
 * cool to hot.
 *
 * **Headline quiet zone.** The left third of the frame is reserved for type.
 * Every emissive element is authored to the right of centre, and sparks and
 * smoke additionally multiply their alpha by a world-space `x` gate, so no
 * stray ember can ever wander into the headline.
 *
 * All stochastic placement runs through a seeded PRNG, so the thumbnail and
 * the reduced-motion still frame are reproducible.
 */
import * as THREE from "three";
import { createRng, hashSeed, type Rng } from "../../engine/rng";
import type { PropValues, RecipeMeta, SceneContext } from "../../engine/types";

/* ------------------------------------------------------------------ *
 * Stage — authored in world units on the z = 0 reference plane. The
 * camera is dollied to "contain" this box, so the composition (and the
 * left-hand quiet zone) survives any viewport aspect ratio.
 * ------------------------------------------------------------------ */
const FIT_W_HALF = 6.8;
const FIT_H_HALF = 3.8;

/** The pour's spine: it enters above the frame and lands on the anvil. */
const POUR_TOP: [number, number] = [4.35, 4.9];
const POUR_IMPACT: [number, number] = [1.55, -2.35];
const SPINE_SEGMENTS = 96;

/** Anything left of this fades out — the headline lives here. */
const QUIET_X = -2.05;
const QUIET_FADE = -0.65;

const BACKGROUND = 0x070605;

/* ------------------------------------------------------------------ *
 * Variants
 * ------------------------------------------------------------------ */

interface Tuning {
  /** Blackbody-ish ramp: edge (coolest) → mid → core (hottest). */
  edge: number;
  mid: number;
  core: number;
  /** The single point light near the pool. */
  light: number;
  lightGain: number;
  /** Ribbon flow speed multiplier. */
  flow: number;
  /** Overall emissive gain. */
  glow: number;
  /** Ribbon width multiplier. */
  width: number;
  /** Base wobble amplitude. */
  turb: number;
  sparkCount: number;
  sparkSpeed: number;
  sparkGravity: number;
  smokeTint: number;
  smokeGain: number;
}

function tuningFor(variant: string): Tuning {
  switch (variant) {
    case "gold":
      // Deeper amber, a heavier and slower stream, richer halo.
      return {
        edge: 0xb8590a,
        mid: 0xffb742,
        core: 0xfff1c4,
        light: 0xffa034,
        lightGain: 7.5,
        flow: 0.62,
        glow: 1.22,
        width: 1.18,
        turb: 0.8,
        sparkCount: 1000,
        sparkSpeed: 0.8,
        sparkGravity: 6.2,
        smokeTint: 0x6b4018,
        smokeGain: 1.15,
      };
    case "plasma":
      // Electric blue-white. Restrained: the ramp stays dark at the edges.
      return {
        edge: 0x1a3a8a,
        mid: 0x4a8aff,
        core: 0xe0f0ff,
        light: 0x5a90ff,
        lightGain: 6,
        flow: 1.45,
        glow: 0.95,
        width: 0.86,
        turb: 1.35,
        sparkCount: 1500,
        sparkSpeed: 1.5,
        sparkGravity: 5,
        smokeTint: 0x2b3f6b,
        smokeGain: 0.8,
      };
    default:
      // steel — the art target: white-hot core, orange body, deep red edge.
      return {
        edge: 0xd84315,
        mid: 0xff9a3c,
        core: 0xfff6e0,
        light: 0xff7a2a,
        lightGain: 6.5,
        flow: 1,
        glow: 1,
        width: 1,
        turb: 1,
        sparkCount: 1200,
        sparkSpeed: 1,
        sparkGravity: 7,
        smokeTint: 0x5a3418,
        smokeGain: 1,
      };
  }
}

/* ------------------------------------------------------------------ *
 * Shared shader snippets
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
`;

/**
 * Temperature ramp, approximating a blackbody heat scale: 0 is the cool
 * outer edge of the stream, 1 is the white-hot core. Two mixes are enough —
 * the eye reads the hue rotation, not the spectral accuracy.
 */
const RAMP_GLSL = /* glsl */ `
  uniform vec3 uEdge;
  uniform vec3 uMid;
  uniform vec3 uCore;
  vec3 emberRamp(float t) {
    t = clamp(t, 0.0, 1.0);
    return t < 0.5
      ? mix(uEdge, uMid, t * 2.0)
      : mix(uMid, uCore, (t - 0.5) * 2.0);
  }
`;

/**
 * The headline gate. Alpha is driven to zero left of QUIET_X so the left
 * third of the frame stays near-black in every variant, whatever the sim
 * does. Applied to sparks and smoke, the only elements that can travel.
 */
const QUIET_GLSL = /* glsl */ `
  float quietGate(float worldX) {
    return smoothstep(${QUIET_X.toFixed(2)}, ${QUIET_FADE.toFixed(2)}, worldX);
  }
`;

/**
 * Vertex-shader spine deformation — the *only* "heat shimmer" in the recipe.
 * Shared verbatim by the halo and core ribbons so they writhe as one body.
 * Amplitude ramps in below the crucible lip (where the stream is still
 * constrained) and grows as the metal falls and breaks up.
 */
const WOBBLE_GLSL = /* glsl */ `
  uniform float uTurb;
  uniform float uTime;
  uniform float uFlow;
  vec3 spineWobble(float along) {
    float t = uTime * uFlow;
    float amp = uTurb * (0.06 + 0.3 * smoothstep(0.05, 0.9, along));
    float nx = vnoise1(along * 3.2 - t * 1.9) - 0.5;
    float nz = vnoise1(along * 2.6 + 31.7 + t * 1.4) - 0.5;
    float ny = vnoise1(along * 6.0 + 77.3 - t * 2.4) - 0.5;
    return vec3(nx * amp, ny * amp * 0.35, nz * amp * 0.7);
  }
`;

/* ------------------------------------------------------------------ *
 * The pour spine
 * ------------------------------------------------------------------ */

interface SpineSample {
  p: THREE.Vector3;
  tangent: THREE.Vector3;
  half: number;
}

/**
 * Position along the stream for `t` in [0, 1]. The metal leaves the lip
 * moving sideways and is bent downward by gravity, so `y` is quadratic in
 * `t` while `x` eases out — the classic pour arc, authored rather than
 * simulated so the composition is identical every run.
 */
function spinePoint(t: number, out: THREE.Vector3): THREE.Vector3 {
  const x = POUR_TOP[0] + (POUR_IMPACT[0] - POUR_TOP[0]) * (1 - Math.pow(1 - t, 1.4));
  const y = POUR_TOP[1] + (POUR_IMPACT[1] - POUR_TOP[1]) * (0.3 * t + 0.7 * t * t);
  return out.set(x, y, 0);
}

/**
 * Stream half-width. It necks down as the metal accelerates (mass flow is
 * constant, so faster means thinner) and flares again where it hits the pool.
 */
function spineHalf(t: number): number {
  const neck = 0.46 * (1.12 - 0.44 * t);
  const flare = 0.55 * Math.pow(Math.max(0, (t - 0.86) / 0.14), 1.6);
  return neck + flare;
}

function sampleSpine(): SpineSample[] {
  const out: SpineSample[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i <= SPINE_SEGMENTS; i++) {
    const t = i / SPINE_SEGMENTS;
    const p = spinePoint(t, new THREE.Vector3());
    // Central difference for the tangent, clamped at the ends.
    spinePoint(Math.max(0, t - 0.004), a);
    spinePoint(Math.min(1, t + 0.004), b);
    out.push({ p, tangent: b.sub(a).normalize(), half: spineHalf(t) });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The pour ribbons — camera-facing quads swept along the spine
 * ------------------------------------------------------------------ */

interface Uniforms {
  uTime: { value: number };
  uFlow: { value: number };
  uHeat: { value: number };
  uTurb: { value: number };
  uSmoke: { value: number };
  uEdge: { value: THREE.Color };
  uMid: { value: THREE.Color };
  uCore: { value: THREE.Color };
}

type UniformMap = { [key: string]: THREE.IUniform };

/**
 * One ribbon pass. `position` holds the undeformed spine; the vertex shader
 * applies the shared wobble and then pushes each edge sideways along
 * `cross(tangent, toCamera)` in view space. A ribbon has no volume, so it can
 * never leave an intersection seam against the anvils, and it always presents
 * its full width no matter where the camera sits.
 *
 * @param widthScale wide (halo) or narrow (core)
 * @param gain       additive strength
 * @param softness   exponent of the radial falloff — higher is tighter
 * @param hot        how far up the temperature ramp this pass sits
 */
function buildRibbon(
  spine: SpineSample[],
  u: Uniforms,
  tuning: Tuning,
  widthScale: number,
  gain: number,
  softness: number,
  hot: number,
  renderOrder: number,
): THREE.Mesh {
  const count = spine.length;
  const pos = new Float32Array(count * 2 * 3);
  const tan = new Float32Array(count * 2 * 3);
  const side = new Float32Array(count * 2);
  const along = new Float32Array(count * 2);
  const half = new Float32Array(count * 2);
  const index: number[] = [];

  for (let i = 0; i < count; i++) {
    const s = spine[i];
    for (let k = 0; k < 2; k++) {
      const v = i * 2 + k;
      pos[v * 3] = s.p.x;
      pos[v * 3 + 1] = s.p.y;
      pos[v * 3 + 2] = s.p.z;
      tan[v * 3] = s.tangent.x;
      tan[v * 3 + 1] = s.tangent.y;
      tan[v * 3 + 2] = s.tangent.z;
      side[v] = k === 0 ? -1 : 1;
      along[v] = i / (count - 1);
      half[v] = s.half * widthScale;
    }
    if (i < count - 1) {
      const base = i * 2;
      index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aTangent", new THREE.BufferAttribute(tan, 3));
  geometry.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
  geometry.setAttribute("aAlong", new THREE.BufferAttribute(along, 1));
  geometry.setAttribute("aHalf", new THREE.BufferAttribute(half, 1));
  geometry.setIndex(index);

  const uniforms = {
    uTime: u.uTime,
    uFlow: u.uFlow,
    uHeat: u.uHeat,
    uTurb: u.uTurb,
    uEdge: u.uEdge,
    uMid: u.uMid,
    uCore: u.uCore,
    uGain: { value: gain * tuning.glow },
    uSoft: { value: softness },
    uHot: { value: hot },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as UniformMap,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aTangent;
      attribute float aSide;
      attribute float aAlong;
      attribute float aHalf;
      varying float vSide;
      varying float vAlong;
      ${NOISE_GLSL}
      ${WOBBLE_GLSL}
      void main() {
        vec3 p = position + spineWobble(aAlong);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vec3 tv = normalize((modelViewMatrix * vec4(aTangent, 0.0)).xyz);
        // The camera is at the origin in view space.
        vec3 toCam = normalize(-mv.xyz);
        vec3 perp = cross(tv, toCam);
        float len = length(perp);
        // Degenerate only when looking straight down the stream, which the
        // fixed camera never does; fall back to screen-right regardless.
        perp = len > 1e-4 ? perp / len : vec3(1.0, 0.0, 0.0);
        mv.xyz += perp * aSide * aHalf;
        vSide = aSide;
        vAlong = aAlong;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform float uFlow;
      uniform float uHeat;
      uniform float uGain;
      uniform float uSoft;
      uniform float uHot;
      varying float vSide;
      varying float vAlong;
      ${NOISE_GLSL}
      ${RAMP_GLSL}
      void main() {
        float u = min(abs(vSide), 1.0);
        // Flat-topped halo that reaches zero smoothly at the quad edge, with
        // a tight gaussian core on top. Anything sharper reads as a stick.
        float halo = pow(max(0.0, 1.0 - u * u), uSoft);
        float core = exp(-u * u * 7.0);

        // Molten skin: streaks scrolling down the stream, faster than the
        // stream reads so the surface looks like it is being dragged. This is
        // the UV-space shimmer that replaces a screen-space haze pass.
        float scroll = uTime * uFlow;
        float skin = vnoise2(vec2(vAlong * 26.0 - scroll * 3.4, vAlong * 4.0 + scroll * 0.6));
        skin += 0.5 * vnoise2(vec2(vAlong * 61.0 - scroll * 5.1, 12.0));

        float temp = uHot * (core * 0.9 + halo * 0.35) + (skin / 1.5 - 0.5) * 0.42;
        // The metal cools as it falls: the foot of the stream sits lower on
        // the ramp than the lip.
        temp -= 0.16 * smoothstep(0.15, 0.95, vAlong);

        // Both ends dissolve: the lip is off-frame, the foot hands over to
        // the pool glow. Neither may show a cut edge on any aspect ratio.
        float head = smoothstep(0.0, 0.05, vAlong);
        float foot = 1.0 - 0.45 * smoothstep(0.9, 1.0, vAlong);
        float breathe = 0.92 + 0.08 * sin(scroll * 1.7 + vAlong * 5.0);

        float a = (halo * 0.6 + core * 0.55) * head * foot * breathe;
        a *= (0.82 + 0.36 * clamp(skin / 1.5, 0.0, 1.0));
        a *= uHeat * uGain;
        if (a < 0.003) discard;
        gl_FragColor = vec4(emberRamp(temp), a);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  return mesh;
}

/* ------------------------------------------------------------------ *
 * Impact pool — additive radial gradient, slowly pulsing
 * ------------------------------------------------------------------ */

function buildPool(u: Uniforms, tuning: Tuning, gain: number, pulse: number): THREE.Mesh {
  const uniforms = {
    uTime: u.uTime,
    uHeat: u.uHeat,
    uEdge: u.uEdge,
    uMid: u.uMid,
    uCore: u.uCore,
    uGain: { value: gain * tuning.glow },
    uPulse: { value: pulse },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as UniformMap,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform float uHeat;
      uniform float uGain;
      uniform float uPulse;
      varying vec2 vUv;
      ${RAMP_GLSL}
      void main() {
        float d = length((vUv - 0.5) * 2.0);
        float halo = pow(max(0.0, 1.0 - d * d), 1.9);
        float hot = exp(-d * d * 9.0);
        // Two slow, incommensurate beats so the pulse never feels metronomic.
        float pulse = 1.0 + uPulse * (0.6 * sin(uTime * 1.15) + 0.4 * sin(uTime * 0.47));
        float a = (halo * 0.42 + hot * 0.8) * pulse * uHeat * uGain;
        if (a < 0.003) discard;
        gl_FragColor = vec4(emberRamp(0.35 + hot * 0.75), a);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  return mesh;
}

/* ------------------------------------------------------------------ *
 * Billboard quad batches — shared scaffolding for sparks and smoke
 * ------------------------------------------------------------------ */

const CORNERS: Array<[number, number]> = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

/** Corner attribute + index buffer for `count` independent quads. */
function quadScaffold(count: number): { corner: Float32Array; index: number[] } {
  const corner = new Float32Array(count * 4 * 2);
  const index: number[] = [];
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 4; c++) {
      corner[(i * 4 + c) * 2] = CORNERS[c][0];
      corner[(i * 4 + c) * 2 + 1] = CORNERS[c][1];
    }
    const base = i * 4;
    index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  return { corner, index };
}

/** Write one value to all four vertices of quad `i`. */
function fillQuad(target: Float32Array, i: number, stride: number, values: number[]): void {
  for (let c = 0; c < 4; c++) {
    const v = (i * 4 + c) * stride;
    for (let k = 0; k < stride; k++) target[v + k] = values[k];
  }
}

/* ------------------------------------------------------------------ *
 * Sparks — closed-form ballistics, stretched along screen velocity
 * ------------------------------------------------------------------ */

function buildSparks(count: number, u: Uniforms, tuning: Tuning, rng: Rng): THREE.Mesh {
  const { corner, index } = quadScaffold(count);
  const pos = new Float32Array(count * 4 * 3);
  const vel = new Float32Array(count * 4 * 3);
  const seed = new Float32Array(count * 4);
  const dur = new Float32Array(count * 4);
  const size = new Float32Array(count * 4);

  const [ix, iy] = POUR_IMPACT;
  for (let i = 0; i < count; i++) {
    // Emitted from the impact pool, scattered along the splash ellipse.
    const ox = ix + rng.signed(0.55);
    const oy = iy + rng.range(-0.1, 0.22);
    const oz = rng.signed(0.35);

    // A cone biased up and to the right: leftward sparks exist (they sell the
    // splash) but are slow, and the quiet gate fades whatever escapes.
    const angle = rng.range(-0.55, 1.05);
    const speed = 1.1 + Math.pow(rng.next(), 2.1) * 5.2;
    const vx = Math.sin(angle) * speed * 1.15;
    const vy = Math.cos(angle) * speed;
    const vz = rng.signed(0.7);

    fillQuad(pos, i, 3, [ox, oy, oz]);
    fillQuad(vel, i, 3, [vx, vy, vz]);
    fillQuad(seed, i, 1, [rng.next()]);
    fillQuad(dur, i, 1, [rng.range(0.7, 2.1)]);
    // Heavily skewed: a few big embers among a lot of fine grit.
    fillQuad(size, i, 1, [0.012 + Math.pow(rng.next(), 3.2) * 0.07]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aVel", new THREE.BufferAttribute(vel, 3));
  geometry.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geometry.setAttribute("aDur", new THREE.BufferAttribute(dur, 1));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geometry.setIndex(index);

  const uniforms = {
    uTime: u.uTime,
    uHeat: u.uHeat,
    uEdge: u.uEdge,
    uMid: u.uMid,
    uCore: u.uCore,
    uSpeed: { value: tuning.sparkSpeed },
    uGravity: { value: tuning.sparkGravity },
    uGain: { value: tuning.glow },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as UniformMap,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aVel;
      attribute vec2 aCorner;
      attribute float aSeed;
      attribute float aDur;
      attribute float aSize;
      uniform float uTime;
      uniform float uSpeed;
      uniform float uGravity;
      varying vec2 vQuad;
      varying float vLife;
      varying float vFade;
      ${QUIET_GLSL}
      void main() {
        // Wrapped lifetime, evaluated in closed form: no CPU integration, so
        // one big warm-up step composes the same spray as many small ones.
        float life = fract(aSeed + uTime * uSpeed / aDur);
        float t = life * aDur;
        vec3 g = vec3(0.0, -uGravity, 0.0);
        vec3 p = position + aVel * t + 0.5 * g * t * t;
        vec3 v = aVel + g * t;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vec2 vv = (modelViewMatrix * vec4(v, 0.0)).xy;
        float sp = length(vv);
        vec2 dir = sp > 1e-4 ? vv / sp : vec2(0.0, 1.0);
        // Motion streak: length grows with screen speed, clamped so a fast
        // ember never becomes a laser.
        float stretch = aSize * (1.0 + min(sp * 0.55, 5.0));
        mv.xy += dir * aCorner.y * stretch + vec2(-dir.y, dir.x) * aCorner.x * aSize;

        vQuad = aCorner;
        vLife = life;
        // Fade in fast, cool out slow, and gate the headline zone.
        vFade = smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.45, 1.0, life)) * quietGate(p.x);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uHeat;
      uniform float uGain;
      varying vec2 vQuad;
      varying float vLife;
      varying float vFade;
      ${RAMP_GLSL}
      void main() {
        // Radial falloff in quad space — no hard edge to pop against.
        float r2 = dot(vQuad, vQuad);
        float shape = exp(-r2 * 3.4);
        // The leading end of the streak is the hot one.
        float head = 0.5 + 0.5 * smoothstep(-1.0, 1.0, vQuad.y);
        float temp = (1.0 - vLife * 0.85) * head;
        float a = shape * head * vFade * uHeat * uGain * 1.35;
        if (a < 0.004) discard;
        gl_FragColor = vec4(emberRamp(temp), a);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  return mesh;
}

/* ------------------------------------------------------------------ *
 * Smoke — a handful of big, near-invisible billboards
 * ------------------------------------------------------------------ */

const SMOKE_COUNT = 9;

function buildSmoke(u: Uniforms, tuning: Tuning, rng: Rng): THREE.Mesh {
  const { corner, index } = quadScaffold(SMOKE_COUNT);
  const pos = new Float32Array(SMOKE_COUNT * 4 * 3);
  const seed = new Float32Array(SMOKE_COUNT * 4);
  const size = new Float32Array(SMOKE_COUNT * 4);
  const rise = new Float32Array(SMOKE_COUNT * 4);

  for (let i = 0; i < SMOKE_COUNT; i++) {
    // Clustered around the pour, well clear of the headline zone.
    fillQuad(pos, i, 3, [rng.range(0.3, 4.6), rng.range(-2.6, -1.2), rng.range(-1.6, -0.4)]);
    fillQuad(seed, i, 1, [rng.next()]);
    fillQuad(size, i, 1, [rng.range(1.5, 3.1)]);
    fillQuad(rise, i, 1, [rng.range(0.6, 1.4)]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geometry.setAttribute("aRise", new THREE.BufferAttribute(rise, 1));
  geometry.setIndex(index);

  const uniforms = {
    uTime: u.uTime,
    uSmoke: u.uSmoke,
    uTint: { value: new THREE.Color(tuning.smokeTint) },
    uGain: { value: tuning.smokeGain },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as UniformMap,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec2 aCorner;
      attribute float aSeed;
      attribute float aSize;
      attribute float aRise;
      uniform float uTime;
      varying vec2 vQuad;
      varying float vAlpha;
      ${QUIET_GLSL}
      void main() {
        float phase = aSeed * 6.28318;
        float life = fract(aSeed + uTime * 0.028 * aRise);
        vec3 p = position;
        p.y += life * 6.5 * aRise;
        p.x += sin(uTime * 0.11 + phase) * 0.55 + life * 0.7;

        // Plumes expand as they cool and slow.
        float scale = aSize * (0.55 + life * 1.5);
        float spin = phase + uTime * 0.035 * (aSeed - 0.5);
        vec2 rot = vec2(
          aCorner.x * cos(spin) - aCorner.y * sin(spin),
          aCorner.x * sin(spin) + aCorner.y * cos(spin)
        );

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        mv.xy += rot * scale;
        vQuad = aCorner;
        vAlpha = smoothstep(0.0, 0.18, life) * (1.0 - smoothstep(0.45, 1.0, life)) * quietGate(p.x);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uTint;
      uniform float uSmoke;
      uniform float uGain;
      varying vec2 vQuad;
      varying float vAlpha;
      void main() {
        float r2 = dot(vQuad, vQuad);
        // Very soft and very dim: smoke is a suggestion, not a subject.
        float shape = pow(max(0.0, 1.0 - r2), 2.2);
        float a = shape * vAlpha * uSmoke * uGain * 0.16;
        if (a < 0.002) discard;
        gl_FragColor = vec4(uTint, a);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}

/* ------------------------------------------------------------------ *
 * Recipe
 * ------------------------------------------------------------------ */

const emberworks: RecipeMeta = {
  slug: "emberworks",
  title: "Emberworks",
  category: "landing",
  description:
    "A molten metal pour in a dark forge, for dev-tools and CI/CD brands that build in metal. The stream is two camera-facing ribbons — a wide dim halo behind a white-hot core — swept along one authored spine and deformed by value noise in the vertex shader, so nothing is re-tessellated per frame. Sparks are 1.2k additive quads, each a closed-form ballistic stretched along its own screen-space velocity. Glow is additive layering only: no bloom, no render targets, and no screen-space heat haze. A single dim point light at the impact pool is the scene's only light, and the left third is gated dark for a headline.",
  tags: ["landing", "hero", "particles", "emissive", "dark-mode"],
  variants: [
    { id: "steel", label: "Steel" },
    { id: "gold", label: "Gold" },
    { id: "plasma", label: "Plasma" },
  ],
  props: [
    { key: "pour", label: "Pour", min: 0, max: 2.5, step: 0.05, default: 1 },
    { key: "sparks", label: "Sparks", min: 0, max: 2, step: 0.05, default: 1, rebuild: true },
    { key: "heat", label: "Heat", min: 0, max: 2, step: 0.05, default: 1 },
    { key: "turbulence", label: "Turbulence", min: 0, max: 2.5, step: 0.05, default: 1 },
    { key: "smoke", label: "Smoke", min: 0, max: 2, step: 0.05, default: 1 },
  ],
  /**
   * Every motion in the scene is a closed-form function of the accumulated
   * clock, so one 6-second step composes exactly what six seconds of frames
   * would: sparks spread across their whole lifetime range, smoke risen,
   * pool mid-pulse. Shorter warm-ups catch the spray still bunched at the
   * emitter.
   */
  thumbnailWarmup: 6,

  create({ scene, camera, variant, props }: SceneContext) {
    const tuning = tuningFor(variant);
    const rng = createRng(hashSeed(`emberworks:${variant}`));
    scene.background = new THREE.Color(BACKGROUND);

    const u: Uniforms = {
      uTime: { value: 0 },
      uFlow: { value: props.pour * tuning.flow },
      uHeat: { value: props.heat },
      uTurb: { value: props.turbulence * tuning.turb },
      uSmoke: { value: props.smoke },
      uEdge: { value: new THREE.Color(tuning.edge) },
      uMid: { value: new THREE.Color(tuning.mid) },
      uCore: { value: new THREE.Color(tuning.core) },
    };

    /* -- silhouettes (opaque, renderOrder 0): lit only by the pour -- */
    const darkMetal = new THREE.MeshStandardMaterial({
      color: 0x14100e,
      roughness: 0.82,
      metalness: 0.35,
    });

    // Crucible: a tipped, open cylinder whose lip sits above the frame, so it
    // reads as a heavy dark wedge the stream falls out of.
    const crucible = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.15, 2.4, 24, 1, true),
      darkMetal,
    );
    crucible.position.set(5.4, 5.15, -0.6);
    crucible.rotation.set(0.12, 0, -1.15);
    crucible.renderOrder = 0;
    scene.add(crucible);

    // Anvil blocks: dark boxes across the bottom edge, barely rimmed by the
    // pool light. Their tops meet the impact point.
    // Every block sits behind z = 0 so the additive pool and runoff — which
    // are authored on the z ≈ 0.2 plane — are never occluded by a front face.
    const blocks: Array<[number, number, number, number, number, number]> = [
      // x, y, z, width, height, rotation
      [1.7, -3.15, -1.5, 3.4, 1.5, -0.03],
      // The outermost blocks run past the widest fit so a portrait viewport,
      // which pulls the camera back, never exposes a floating end.
      [5.9, -3.45, -2.1, 6, 1.4, 0.05],
      [-1.5, -3.55, -1.8, 3.6, 1.5, 0.02],
      [-5.6, -3.9, -2.6, 6, 1.6, -0.04],
    ];
    for (const [x, y, z, w, h, rot] of blocks) {
      const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, 2.2), darkMetal);
      block.position.set(x, y, z);
      block.rotation.z = rot;
      block.renderOrder = 0;
      scene.add(block);
    }

    /* -- the scene's only light: a dim orange bounce at the pool -- */
    const pointLight = new THREE.PointLight(tuning.light, tuning.lightGain * props.heat, 9, 2);
    pointLight.position.set(POUR_IMPACT[0], POUR_IMPACT[1] + 0.35, 1.1);
    scene.add(pointLight);

    /* -- smoke (5): behind everything glowing -- */
    scene.add(buildSmoke(u, tuning, rng));

    /* -- impact pool (8): a hot core plus a stretched runoff -- */
    const pool = buildPool(u, tuning, 1, 0.16);
    pool.position.set(POUR_IMPACT[0], POUR_IMPACT[1] + 0.05, 0.2);
    pool.scale.set(3.4 * tuning.width, 1.5 * tuning.width, 1);
    scene.add(pool);

    const runoff = buildPool(u, tuning, 0.42, 0.1);
    // Spreads along the anvil top, stopping well short of the quiet zone.
    runoff.position.set(POUR_IMPACT[0] - 0.8, POUR_IMPACT[1] - 0.34, 0.15);
    runoff.scale.set(5, 0.7, 1);
    scene.add(runoff);

    // A very wide, very dim halo standing in for bloom around the impact.
    const bloomHalo = buildPool(u, tuning, 0.34, 0.22);
    bloomHalo.position.set(POUR_IMPACT[0], POUR_IMPACT[1] + 0.5, -0.4);
    bloomHalo.scale.set(9, 7, 1);
    bloomHalo.renderOrder = 7; // behind the tighter pool passes
    scene.add(bloomHalo);

    /* -- the pour: wide halo (10) behind the hot core (12) -- */
    const spine = sampleSpine();
    scene.add(buildRibbon(spine, u, tuning, 3.6 * tuning.width, 0.3, 1.4, 0.45, 10));
    scene.add(buildRibbon(spine, u, tuning, 1.9 * tuning.width, 0.5, 2.0, 0.85, 10));
    scene.add(buildRibbon(spine, u, tuning, 1.15 * tuning.width, 0.95, 2.8, 1.2, 12));

    /* -- sparks (20): in front of everything -- */
    const builtSparks = props.sparks;
    const sparkCount = Math.round(
      THREE.MathUtils.clamp(tuning.sparkCount * builtSparks, 0, 2000),
    );
    if (sparkCount > 0) scene.add(buildSparks(sparkCount, u, tuning, rng));

    /**
     * Camera: a fixed hero pose, dollied to *contain* the authored stage.
     * A hero must never crop its own subject, so narrow viewports pull back
     * rather than losing the pour or the quiet zone.
     */
    function fitCamera(): void {
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const aspect = camera.aspect > 0.01 ? camera.aspect : 1;
      const z = Math.max(FIT_H_HALF / tanHalf, FIT_W_HALF / (tanHalf * aspect));
      camera.position.set(0, 0, z);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    }
    fitCamera();

    return {
      update(_elapsed: number, dt: number) {
        fitCamera();
        u.uTime.value += dt;
      },
      applyProps(next: PropValues) {
        if (next.sparks !== builtSparks) return false; // particle count is baked in
        u.uFlow.value = next.pour * tuning.flow;
        u.uHeat.value = next.heat;
        u.uTurb.value = next.turbulence * tuning.turb;
        u.uSmoke.value = next.smoke;
        pointLight.intensity = tuning.lightGain * next.heat;
        return true;
      },
      dispose() {
        // The harness disposes the scene graph; the background is scene state.
        scene.background = null;
      },
    };
  },
};

export default emberworks;
