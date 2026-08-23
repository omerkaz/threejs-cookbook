/**
 * Tideline — a revenue chart line rendered as a luminous ocean tide.
 *
 * The technique is four transparent layers stacked on a dark navy stage,
 * all driven by one shared curve:
 *
 *  1. a seeded chart spline (centripetal Catmull-Rom, trough-clamped so it
 *     always reads as a plausible revenue chart — no dips below prior lows),
 *  2. a water body: an indexed grid mesh hanging below the spline, shaded
 *     with a teal depth gradient and vertical filament shimmer,
 *  3. a crest: two quad ribbons (soft halo + bright core) swept vertically
 *     off the spline — ribbons, never `linewidth`, which is capped at 1px
 *     on ANGLE/Windows,
 *  4. foam: additive point sprites (canvas-generated radial gradient) that
 *     rise off the crest, sparkle, and recycle.
 *
 * The crest undulation lives in GLSL as `crestOffset(t, time)` and is shared
 * verbatim by all three shaders, so water, ribbon, and foam breathe together
 * without any CPU-side re-tessellation. Glow is additive blending only — no
 * postprocessing, no external assets. All stochastic placement runs through a
 * seeded PRNG so thumbnails and reduced-motion still frames are reproducible.
 */
import * as THREE from "three";
import { createRng, hashSeed } from "../../engine/rng";
import type { PropValues, RecipeMeta, SceneContext } from "../../engine/types";

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
const BACKGROUND = 0x050b14;

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
  foamCount: number;
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
        foamCount: 3000,
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
        foamCount: 1800,
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
        foamCount: 2600,
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
    let y = Number.isFinite(tmp.y) ? tmp.y : 0;
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
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
  geometry.setAttribute("aDepth", new THREE.BufferAttribute(aDepth, 1));
  geometry.setIndex(index);

  const material = new THREE.ShaderMaterial({
    uniforms: u as unknown as { [key: string]: THREE.IUniform },
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
      ${NOISE_GLSL}
      void main() {
        vT = aT;
        vDepth = aDepth;
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
      ${NOISE_GLSL}
      void main() {
        vec3 shallow = vec3(0.42, 0.97, 0.92);
        vec3 mid = vec3(0.09, 0.62, 0.68);
        vec3 deep = vec3(0.03, 0.34, 0.46);
        vec3 color = mix(shallow, mid, smoothstep(0.0, 0.42, vDepth));
        color = mix(color, deep, smoothstep(0.4, 1.15, vDepth));

        // Vertical filaments: the "hanging curtain" look under the crest.
        float streak = vnoise2(vec2(vT * 210.0, vDepth * 2.2 - uTime * 0.12));
        streak = mix(streak, vnoise2(vec2(vT * 74.0, vDepth * 1.1 + uTime * 0.07)), 0.5);
        streak = pow(streak, 1.35);

        float body = pow(1.0 - vDepth, 0.62);
        float alpha = body * (0.22 + 1.0 * streak) * 0.82;
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

/**
 * Crest ribbon: two triangles per sample pair, expanded in the vertex
 * shader. Width is a uniform, so it can stay live, and the whole thing is
 * immune to the 1px `linewidth` cap of LineBasicMaterial.
 */
function buildRibbon(
  c: CurveData,
  u: Uniforms,
  width: number,
  softness: number,
  gain: number,
  white: number,
) {
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
    uniforms: {
      ...(u as unknown as { [key: string]: THREE.IUniform }),
      uWidth: { value: width },
      uSoftness: { value: softness },
      uGain: { value: gain },
      uWhite: { value: white },
    },
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
      varying float vSide;
      varying float vT;
      ${NOISE_GLSL}
      void main() {
        vSide = aSide;
        vT = aT;
        vec3 p = position;
        p.y += crestOffset(aT, uTime, uSwell);
        // Offset vertically rather than along the curve normal: the chart is a
        // function graph, so a vertical sweep can never self-intersect at the
        // tight crest turns (normal offsets fan out into visible spikes there).
        p.y += aSide * uWidth;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uGlow;
      uniform float uSoftness;
      uniform float uGain;
      uniform float uWhite;
      varying float vSide;
      varying float vT;
      void main() {
        float d = abs(vSide);
        float core = exp(-d * d * uSoftness);
        vec3 color = mix(vec3(0.13, 0.72, 0.82), vec3(0.88, 1.0, 0.97), pow(core, 2.0) * uWhite);
        float alpha = core * uGain * (0.45 + 0.75 * vT) * uGlow;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
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
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.28, "rgba(190,255,248,0.72)");
    g.addColorStop(1, "rgba(120,235,225,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildFoam(c: CurveData, u: Uniforms, t: Tuning, rng: ReturnType<typeof createRng>) {
  const count = t.foamCount;
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
    aSize[i] = 0.42 + Math.pow(rng.next(), 3.0) * 1.35;
    aRise[i] = 0.4 + rng.next() * 1.2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(aPhase, 1));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1));
  geometry.setAttribute("aRise", new THREE.BufferAttribute(aRise, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: u as unknown as { [key: string]: THREE.IUniform },
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
      varying float vAlpha;
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

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aSize * 40.0 / max(-mv.z, 0.001);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uSprite;
      uniform float uGlow;
      varying float vAlpha;
      void main() {
        vec4 sprite = texture2D(uSprite, gl_PointCoord);
        float a = sprite.a * vAlpha * uGlow;
        if (a < 0.004) discard;
        gl_FragColor = vec4(sprite.rgb * (0.8 + 0.5 * uGlow), a);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 4;
  return points;
}

/**
 * Grid + axis ticks, also as quad ribbons. Vertical lines are clipped to the
 * water surface and horizontals only exist where the tide has risen past
 * them, so the empty upper-left stays uncluttered.
 */
function buildGrid(c: CurveData, u: Uniforms) {
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
    uniforms: u as unknown as { [key: string]: THREE.IUniform },
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
      void main() {
        float lateral = 0.35 + 0.65 * smoothstep(${X_MIN.toFixed(1)}, ${X_MAX.toFixed(1)}, vX);
        float a = vFade * lateral * uGridOpacity;
        gl_FragColor = vec4(vec3(0.30, 0.70, 0.74) * 0.8, a);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
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
    "A landing-page hero where the revenue chart is the ocean: a seeded centripetal Catmull-Rom spline drives a shimmering water body, a quad-ribbon crest, and thousands of additive foam sprites. Ribbons instead of lines (no linewidth cap), additive glow instead of postprocessing, and a calm left third reserved for the headline.",
  tags: ["landing", "hero", "shadermaterial", "particles", "additive"],
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

  create({ scene, camera, variant, props }: SceneContext) {
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
    };

    // Draw order: water body → grid → crest halo/core → foam.
    const water = buildWater(curve, uniforms);
    const grid = buildGrid(curve, uniforms);
    const halo = buildRibbon(curve, uniforms, 0.46, 3.2, 0.3, 0.0);
    const core = buildRibbon(curve, uniforms, 0.03, 5.5, 0.95, 1.0);
    const foam = buildFoam(curve, uniforms, tuning, rng);
    scene.add(water, grid, halo, core, foam);

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
      applyProps(next: PropValues) {
        uniforms.uSwell.value = next.swell * tuning.swell;
        uniforms.uGlow.value = next.glow * tuning.glow;
        uniforms.uFoam.value = next.foam;
        uniforms.uGridOpacity.value = next.gridOpacity;
        speed = next.speed * tuning.speed;
        return true;
      },
      dispose() {
        // Uniform textures are not reachable by the harness' graph walk.
        sprite.dispose();
        scene.background = null;
      },
    };
  },
};

export default tideline;
