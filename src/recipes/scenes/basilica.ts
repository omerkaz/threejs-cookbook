/**
 * Basilica — a monumental concrete colonnade pierced by a volumetric shaft.
 *
 * The scene is deliberately the quietest in the collection: a 40-second dolly
 * loop, a single beam of light, and dust that barely moves. Everything is
 * built from primitives — no textures, no shadow maps, no postprocessing.
 *
 *  1. two colonnade rows (plus a sparser outer row seen through the gaps)
 *     receding into `FogExp2` darkness. Concrete is a plain
 *     `MeshStandardMaterial` tinted per-vertex with `fbm2` value noise and
 *     faint formwork seams, so it reads as poured concrete for the cost of a
 *     colour attribute,
 *  2. the light shaft: 2–3 stacked quads per beam, each turned to face the
 *     camera *about the beam axis* in the vertex shader (a cylindrical
 *     billboard). A cone mesh would slice through columns and leave hard
 *     intersection lines; a billboard has no volume to intersect,
 *  3. a floor pool — an additive radial-gradient plane where the beam lands,
 *     plus a longer, dimmer copy stretched toward the camera as a reflection,
 *  4. base uplights: additive gradient ribbons pinned to the inner column
 *     faces with a soft disc on the floor, merged into one draw call,
 *  5. dust: additive point sprites whose brightness is `exp(-d²)` in the
 *     distance `d` to the beam axis, so particles drift everywhere but only
 *     light up inside the beam — no hard boundary to pop across.
 *
 * **Why the beam is never clipped by a column.** The colonnade leaves an open
 * slab `|x| < INNER_FACE` between the rows. Every beam is authored to stay
 * inside that slab, and the camera dolly is locked inside it too. A slab is
 * convex, so the segment from the camera to any point of a beam also lies
 * inside it — no column can ever come between them. The guarantee is
 * geometric, not a depth-buffer trick.
 *
 * The dolly is phase-locked to `thumbnailWarmup`: at t = 6s the camera sits
 * at the composed hero pose, which is exactly the frame the thumbnailer and
 * the reduced-motion still render. `dolly = 0` holds that same pose.
 *
 * All stochastic placement runs through a seeded PRNG, so those frames are
 * reproducible.
 */
import * as THREE from "three";
import { fbm2 } from "../../engine/noise";
import { createRng, hashSeed, type Rng } from "../../engine/rng";
import type { PropValues, RecipeMeta, SceneContext } from "../../engine/types";

/* ------------------------------------------------------------------ *
 * Stage — authored in world units. The corridor runs down −z, the floor
 * is y = 0, and the camera sits inside the open slab between the rows.
 * ------------------------------------------------------------------ */

/** Half-width of the open corridor: no column geometry inside |x| < this. */
const INNER_FACE = 4.6;
const COLUMN_W = 2.6;
const COLUMN_H = 36;
const COLUMN_STEP = 6.5;
/** Inner rows: nearest column is behind the camera plane, farthest is fogged out. */
const INNER_Z_NEAR = 9;
const INNER_ROW = 9;
/** Outer rows peek through the gaps and give the recession a second layer. */
const OUTER_X = 9.4;
const OUTER_ROW = 4;

const FLOOR_W = 64;
const FLOOR_D = 110;

/** Composition target: the beam plane. The camera fit is measured here. */
const REF_Z = -6.4;
const FIT_H_HALF = 9.5;
const FIT_W_HALF = 6.2;
const CAM_Y = 2.2;
/** Fixed upward tilt — the "look up at the nave" angle, independent of dolly. */
const TAN_PITCH = 0.228;

/** Seconds per dolly loop. Slow enough that motion is felt, not watched. */
const DOLLY_PERIOD = 40;
/** The dolly phase is zero here, so this instant *is* the hero pose. */
const HERO_T = 6;

/* ------------------------------------------------------------------ *
 * Variants
 * ------------------------------------------------------------------ */

interface Beam {
  /** Upper end (off-frame) and the point where the beam meets the floor. */
  a: [number, number, number];
  b: [number, number, number];
  /** Half-width of the widest quad at the foot of the beam. */
  width: number;
}

interface Tuning {
  background: number;
  concrete: number;
  concreteTint: number;
  floor: number;
  floorMetalness: number;
  floorRoughness: number;
  ambient: number;
  ambientIntensity: number;
  key: number;
  keyIntensity: number;
  beamColor: number;
  coreColor: number;
  poolColor: number;
  uplight: number;
  uplightGain: number;
  beams: Beam[];
  /** Stacked billboard quads per beam. */
  layers: number;
  beamGain: number;
  dustScale: number;
  /** Distance from the beam axis at which dust brightness has decayed to 1/e. */
  dustRadius: number;
  fog: number;
}

/**
 * The hero beam. Its upper end is chosen to leave the frame just past the
 * top edge in landscape, and its |x| stays well inside INNER_FACE so the
 * convexity guarantee above holds with room for the quad width.
 */
const HERO_BEAM: Beam = { a: [3.1, 10.5, 3.6], b: [-0.4, 0, REF_Z], width: 2.2 };

function tuningFor(variant: string): Tuning {
  switch (variant) {
    case "noon":
      return {
        background: 0x08090b,
        concrete: 0x8d9099,
        concreteTint: 0.3,
        floor: 0x3a3d43,
        floorMetalness: 0.2,
        floorRoughness: 0.5,
        ambient: 0x2b3038,
        ambientIntensity: 0.34,
        key: 0xfff6e8,
        keyIntensity: 0.8,
        beamColor: 0xeff3f8,
        coreColor: 0xffffff,
        poolColor: 0xf2f6ff,
        uplight: 0xffe4bd,
        uplightGain: 0.38,
        // Three near-vertical shafts, staggered in depth.
        beams: [
          { a: [-2.2, 22, -7.2], b: [-2.5, 0, -7.6], width: 1.35 },
          { a: [0.6, 24, -10.4], b: [0.4, 0, -10.8], width: 1.1 },
          { a: [2.5, 20, -4.2], b: [2.2, 0, -4.6], width: 1.2 },
        ],
        layers: 2,
        beamGain: 0.8,
        dustScale: 1,
        dustRadius: 1.5,
        fog: 0.017,
      };
    case "bluehour":
      return {
        background: 0x05070c,
        concrete: 0x5c636e,
        concreteTint: 0.34,
        floor: 0x14181f,
        floorMetalness: 0.35,
        floorRoughness: 0.42,
        ambient: 0x1b2740,
        ambientIntensity: 0.3,
        key: 0xbcd4f5,
        keyIntensity: 0.62,
        beamColor: 0x9dc0ea,
        coreColor: 0xe7f2ff,
        poolColor: 0xa8c8f0,
        uplight: 0xc8d8f0,
        uplightGain: 0.3,
        beams: [HERO_BEAM],
        layers: 3,
        beamGain: 1,
        dustScale: 1.05,
        dustRadius: 1.8,
        fog: 0.024,
      };
    case "alert":
      return {
        background: 0x040304,
        concrete: 0x3d3a3c,
        concreteTint: 0.4,
        floor: 0x121011,
        floorMetalness: 0.28,
        floorRoughness: 0.5,
        ambient: 0x2a1418,
        ambientIntensity: 0.28,
        key: 0xd8846a,
        keyIntensity: 0.6,
        beamColor: 0xc0392b,
        coreColor: 0xffb9a0,
        poolColor: 0xd6503a,
        uplight: 0xc06a4a,
        uplightGain: 0.3,
        // Mirrored to the left, a touch steeper — restrained, not neon.
        beams: [{ a: [-3.0, 10.5, 2.6], b: [0.5, 0, -6.8], width: 2 }],
        layers: 3,
        beamGain: 0.92,
        dustScale: 0.85,
        dustRadius: 1.65,
        fog: 0.026,
      };
    default:
      return {
        background: 0x07080a,
        concrete: 0x6f757e,
        concreteTint: 0.32,
        floor: 0x1b1e23,
        floorMetalness: 0.3,
        floorRoughness: 0.46,
        ambient: 0x232a35,
        ambientIntensity: 0.32,
        key: 0xffe9c8,
        keyIntensity: 0.66,
        beamColor: 0xf2d9a8,
        coreColor: 0xfff6e4,
        poolColor: 0xffe9c0,
        uplight: 0xffcf96,
        uplightGain: 0.36,
        beams: [HERO_BEAM],
        layers: 3,
        beamGain: 1,
        dustScale: 1,
        dustRadius: 1.75,
        fog: 0.022,
      };
  }
}

/* ------------------------------------------------------------------ *
 * Concrete: per-vertex value-noise tint + formwork seams
 * ------------------------------------------------------------------ */

/**
 * Multiply a standard material's colour per vertex. The noise is sampled in
 * object space with a per-piece offset, so no two columns share a pattern,
 * and the seams are a cheap triangle wave on y — poured concrete reads as
 * broad vertical streaking cut by horizontal board lines.
 */
function tintConcrete(geometry: THREE.BufferGeometry, rng: Rng, strength: number, seamPitch: number): void {
  const pos = geometry.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  const ox = rng.range(0, 90);
  const oy = rng.range(0, 90);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Streaks: high frequency across the face, low frequency along it.
    const n = fbm2(x * 0.55 + z * 0.31 + ox, y * 0.16 + oy, 3);
    const seam = Math.abs(((y / seamPitch) % 1) - 0.5) * 2; // 0 at the seam
    let b = 1 + (n - 0.5) * strength;
    b -= 0.09 * Math.max(0, 1 - seam * 6);
    const v = THREE.MathUtils.clamp(b, 0.45, 1.5);
    col[i * 3] = v;
    col[i * 3 + 1] = v;
    col[i * 3 + 2] = v;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

/* ------------------------------------------------------------------ *
 * Additive vertex-colour helper — one merged buffer for all uplights
 * ------------------------------------------------------------------ */

class GlowBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  /** Quad given as four corners in order, each with its own alpha. */
  quad(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    a01: number,
    a23: number,
    tint: THREE.Color,
  ): void {
    const base = this.pos.length / 3;
    this.pos.push(...p0, ...p1, ...p2, ...p3);
    for (const a of [a01, a01, a23, a23]) this.col.push(tint.r, tint.g, tint.b, a);
    this.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  /** Floor disc: bright centre fading to nothing at the rim. */
  disc(cx: number, cz: number, rx: number, rz: number, alpha: number, tint: THREE.Color, segments = 20): void {
    const centre = this.pos.length / 3;
    this.pos.push(cx, 0.015, cz);
    this.col.push(tint.r, tint.g, tint.b, alpha);
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      this.pos.push(cx + Math.cos(t) * rx, 0.015, cz + Math.sin(t) * rz);
      this.col.push(tint.r, tint.g, tint.b, 0);
    }
    for (let i = 0; i < segments; i++) this.idx.push(centre, centre + 1 + i, centre + 2 + i);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    // itemSize 4 switches three.js to vertex alpha — no shader needed.
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 4));
    geometry.setIndex(this.idx);
    return geometry;
  }

  get empty(): boolean {
    return this.idx.length === 0;
  }
}

/* ------------------------------------------------------------------ *
 * Shared shader snippets
 * ------------------------------------------------------------------ */

/** Matches THREE.FogExp2 so hand-written materials recede with the rest. */
const FOG_GLSL = /* glsl */ `
  uniform float uFogDensity;
  float depthFade(float viewDepth) {
    float f = viewDepth * uFogDensity;
    return exp(-f * f);
  }
`;

/* ------------------------------------------------------------------ *
 * The beam — stacked cylindrical billboards
 * ------------------------------------------------------------------ */

interface SharedUniforms {
  uIntensity: { value: number };
  uFogDensity: { value: number };
  uTime: { value: number };
}

/**
 * One quad ribbon along the beam axis. `position` holds the axis itself; the
 * vertex shader pushes each edge sideways along the axis-perpendicular that
 * points at the camera, so the ribbon always presents its full width no
 * matter where the dolly is — and, having no volume, it can never produce an
 * intersection seam against the concrete.
 */
function buildBeamQuad(
  beam: Beam,
  shared: SharedUniforms,
  tuning: Tuning,
  widthScale: number,
  gain: number,
  softness: number,
): THREE.Mesh {
  const segments = 24;
  const a = new THREE.Vector3(...beam.a);
  const b = new THREE.Vector3(...beam.b);

  const pos = new Float32Array((segments + 1) * 2 * 3);
  const side = new Float32Array((segments + 1) * 2);
  const along = new Float32Array((segments + 1) * 2);
  const half = new Float32Array((segments + 1) * 2);
  const index: number[] = [];
  const p = new THREE.Vector3();

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    p.copy(a).lerp(b, t);
    // The beam opens up as it falls: narrow at the source, widest on the floor.
    const w = beam.width * widthScale * (0.42 + 0.58 * Math.pow(t, 0.8));
    for (let s = 0; s < 2; s++) {
      const v = i * 2 + s;
      pos[v * 3] = p.x;
      pos[v * 3 + 1] = p.y;
      pos[v * 3 + 2] = p.z;
      side[v] = s === 0 ? -1 : 1;
      along[v] = t;
      half[v] = w;
    }
    if (i < segments) {
      const base = i * 2;
      index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
  geometry.setAttribute("aAlong", new THREE.BufferAttribute(along, 1));
  geometry.setAttribute("aHalf", new THREE.BufferAttribute(half, 1));
  geometry.setIndex(index);

  const uniforms = {
    uIntensity: shared.uIntensity,
    uFogDensity: shared.uFogDensity,
    uTime: shared.uTime,
    uAxisA: { value: a },
    uAxisB: { value: b },
    uColor: { value: new THREE.Color(tuning.beamColor) },
    uCore: { value: new THREE.Color(tuning.coreColor) },
    uGain: { value: gain * tuning.beamGain },
    uSoft: { value: softness },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as { [key: string]: THREE.IUniform },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aSide;
      attribute float aAlong;
      attribute float aHalf;
      uniform vec3 uAxisA;
      uniform vec3 uAxisB;
      varying float vSide;
      varying float vAlong;
      varying float vDepth;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 av = (modelViewMatrix * vec4(uAxisA, 1.0)).xyz;
        vec3 bv = (modelViewMatrix * vec4(uAxisB, 1.0)).xyz;
        vec3 axis = normalize(bv - av);
        // Camera sits at the origin in view space.
        vec3 toCam = normalize(-mv.xyz);
        vec3 perp = cross(axis, toCam);
        float len = length(perp);
        // Degenerate only when looking straight down the beam, which the
        // locked dolly path never does; fall back to screen-right anyway.
        perp = len > 1e-4 ? perp / len : vec3(1.0, 0.0, 0.0);
        mv.xyz += perp * aSide * aHalf;
        vSide = aSide;
        vAlong = aAlong;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor;
      uniform vec3 uCore;
      uniform float uIntensity;
      uniform float uGain;
      uniform float uSoft;
      uniform float uTime;
      varying float vSide;
      varying float vAlong;
      varying float vDepth;
      ${FOG_GLSL}
      void main() {
        float u = min(abs(vSide), 1.0);
        // Radial falloff: one minus u-squared is flat-topped and reaches zero
        // smoothly at the quad edge, which is what keeps the silhouette from
        // reading as a hard-edged stick. A tight gaussian core sits on top.
        float halo = pow(max(0.0, 1.0 - u * u), uSoft);
        float core = exp(-u * u * 6.0);
        // Dissolve at both ends: the source is off-frame, the foot hands over
        // to the floor pool. Neither may show a cut edge on any aspect ratio.
        float head = smoothstep(0.0, 0.16, vAlong);
        float foot = 1.0 - smoothstep(0.9, 1.0, vAlong);
        // Barely-there breathing so the beam is never dead-flat.
        float breathe = 0.94 + 0.06 * sin(uTime * 0.21 + vAlong * 2.0);
        // Scattering thins the beam as it falls, so the source end stays hotter.
        float along = mix(1.0, 0.72, smoothstep(0.1, 0.95, vAlong));
        float a = (halo * 0.72 + core * 0.28) * head * foot * along * breathe;
        a *= depthFade(vDepth) * uIntensity * uGain;
        if (a < 0.002) discard;
        gl_FragColor = vec4(mix(uColor, uCore, core * 0.85), a);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return mesh;
}

/* ------------------------------------------------------------------ *
 * Floor pool — where the beam lands, plus its stretched reflection
 * ------------------------------------------------------------------ */

function buildPoolMaterial(shared: SharedUniforms, tuning: Tuning): THREE.ShaderMaterial {
  const uniforms = {
    uIntensity: shared.uIntensity,
    uFogDensity: shared.uFogDensity,
    uColor: { value: new THREE.Color(tuning.poolColor) },
  };
  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as { [key: string]: THREE.IUniform },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec2 vUv;
      varying float vDepth;
      ${FOG_GLSL}
      void main() {
        float d = length((vUv - 0.5) * 2.0);
        float a = pow(max(0.0, 1.0 - d * d), 1.8) * 0.5;
        // A small hot centre where the beam actually touches the slab.
        a += exp(-d * d * 11.0) * 0.75;
        a *= depthFade(vDepth) * uIntensity;
        if (a < 0.002) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
}

/* ------------------------------------------------------------------ *
 * Dust — additive sprites shaped by distance to the beam axis
 * ------------------------------------------------------------------ */

function makeDustSprite(): THREE.CanvasTexture {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.42)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const DUST_TOP = 16;

function buildDust(
  count: number,
  shared: SharedUniforms,
  tuning: Tuning,
  sprite: THREE.CanvasTexture,
  rng: Rng,
): THREE.Points {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const size = new Float32Array(count);
  const rise = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Biased toward the corridor and the near half of the nave, where the
    // beam is; the far end is fogged out anyway.
    pos[i * 3] = rng.signed(4.4);
    pos[i * 3 + 1] = rng.range(0, DUST_TOP);
    pos[i * 3 + 2] = rng.range(-16, 8);
    seed[i] = rng.next();
    size[i] = 0.4 + Math.pow(rng.next(), 2.4) * 1.5;
    rise[i] = 0.25 + rng.next() * 0.9;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geometry.setAttribute("aRise", new THREE.BufferAttribute(rise, 1));

  const beamCount = Math.max(1, tuning.beams.length);
  const axisA = tuning.beams.map((s) => new THREE.Vector3(...s.a));
  const axisB = tuning.beams.map((s) => new THREE.Vector3(...s.b));

  const uniforms = {
    uIntensity: shared.uIntensity,
    uFogDensity: shared.uFogDensity,
    uTime: shared.uTime,
    uAxisA: { value: axisA },
    uAxisB: { value: axisB },
    uColor: { value: new THREE.Color(tuning.coreColor) },
    uRadius: { value: tuning.dustRadius },
    uSprite: { value: sprite },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as { [key: string]: THREE.IUniform },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      #define BEAMS ${beamCount}
      attribute float aSeed;
      attribute float aSize;
      attribute float aRise;
      uniform vec3 uAxisA[BEAMS];
      uniform vec3 uAxisB[BEAMS];
      uniform float uRadius;
      uniform float uTime;
      varying float vAlpha;
      varying float vDepth;

      float segmentDistance(vec3 p, vec3 a, vec3 b) {
        vec3 ab = b - a;
        float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
        return length(p - (a + ab * t));
      }

      void main() {
        float phase = aSeed * 6.28318;
        vec3 p = position;
        // Slow convection: a gentle rise wrapped over the nave height, with a
        // lazy lateral sway so no two motes travel the same line.
        float life = fract(aSeed + uTime * 0.011 * aRise);
        p.y = life * ${DUST_TOP.toFixed(1)};
        p.x += sin(uTime * 0.07 + phase) * 0.5;
        p.z += cos(uTime * 0.05 + phase * 1.7) * 0.45;

        // Brightness is shaped by the distance to the nearest beam axis, so
        // dust exists everywhere but only glows where light does.
        float best = 1e4;
        for (int i = 0; i < BEAMS; i++) {
          best = min(best, segmentDistance(p, uAxisA[i], uAxisB[i]));
        }
        float r = best / uRadius;
        float lit = exp(-r * r);

        // Fade in and out at the ends of the wrap so recycling never pops.
        float ends = smoothstep(0.0, 0.09, life) * (1.0 - smoothstep(0.88, 1.0, life));
        float twinkle = 0.72 + 0.28 * sin(uTime * 0.8 * aRise + phase * 5.0);
        vAlpha = (lit * 1.15 + 0.015) * ends * twinkle;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vDepth = -mv.z;
        gl_PointSize = aSize * 34.0 / max(-mv.z, 0.001);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uSprite;
      uniform vec3 uColor;
      uniform float uIntensity;
      varying float vAlpha;
      varying float vDepth;
      ${FOG_GLSL}
      void main() {
        vec4 sprite = texture2D(uSprite, gl_PointCoord);
        float a = sprite.a * vAlpha * depthFade(vDepth) * uIntensity;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 20;
  return points;
}

/* ------------------------------------------------------------------ *
 * Recipe
 * ------------------------------------------------------------------ */

const basilica: RecipeMeta = {
  slug: "basilica",
  title: "Basilica",
  category: "landing",
  description:
    "A still, monumental hero for security and infrastructure brands: brutalist concrete columns receding into fog, pierced by a volumetric shaft of light. The shaft is stacked camera-facing billboard quads with a soft radial falloff — never a cone, which would leave hard intersection seams — and it is authored to stay inside the open corridor, so no column can ever clip it. Dust brightness is shaped by distance to the beam axis, concrete is per-vertex value noise, and a 40-second dolly is phase-locked so the still frame is the composed hero pose.",
  tags: ["landing", "hero", "volumetric", "billboard", "dark-mode"],
  variants: [
    { id: "dawn", label: "Dawn" },
    { id: "noon", label: "Noon" },
    { id: "bluehour", label: "Blue Hour" },
    { id: "alert", label: "Alert" },
  ],
  props: [
    { key: "intensity", label: "Intensity", min: 0, max: 2.5, step: 0.05, default: 1 },
    { key: "dust", label: "Dust", min: 0, max: 1.5, step: 0.05, default: 1, rebuild: true },
    { key: "dolly", label: "Dolly", min: 0, max: 2, step: 0.05, default: 1 },
    { key: "haze", label: "Haze", min: 0, max: 2, step: 0.05, default: 1 },
    { key: "uplight", label: "Uplight", min: 0, max: 2, step: 0.05, default: 1 },
  ],
  /** The dolly phase is defined so this instant is the hero pose. */
  thumbnailWarmup: HERO_T,

  create({ scene, camera, variant, props }: SceneContext) {
    const tuning = tuningFor(variant);
    const rng = createRng(hashSeed(`basilica:${variant}`));
    const background = new THREE.Color(tuning.background);
    scene.background = background.clone();

    const fog = new THREE.FogExp2(tuning.background, tuning.fog * props.haze);
    scene.fog = fog;

    const shared: SharedUniforms = {
      uIntensity: { value: props.intensity },
      uFogDensity: { value: fog.density },
      uTime: { value: 0 },
    };

    /* -- lights: one warm key along the beam, plus a dim ambient fill -- */
    const ambient = new THREE.AmbientLight(tuning.ambient, tuning.ambientIntensity);
    scene.add(ambient);

    const hero = tuning.beams[0];
    const key = new THREE.DirectionalLight(tuning.key, tuning.keyIntensity);
    key.position.set(hero.a[0], hero.a[1], hero.a[2]);
    key.target.position.set(hero.b[0], hero.b[1], hero.b[2]);
    scene.add(key, key.target);
    // A whisper of fill from the camera side keeps the near faces off pure black.
    const fill = new THREE.DirectionalLight(tuning.ambient, 0.22);
    fill.position.set(0, 6, 20);
    scene.add(fill);

    /* -- concrete: four tinted box geometries shared across the colonnade -- */
    const columnGeometries: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const geometry = new THREE.BoxGeometry(COLUMN_W, COLUMN_H, COLUMN_W, 2, 18, 2);
      geometry.translate(0, COLUMN_H / 2, 0);
      tintConcrete(geometry, rng, tuning.concreteTint, 2.6);
      columnGeometries.push(geometry);
    }
    const concreteMaterial = new THREE.MeshStandardMaterial({
      color: tuning.concrete,
      roughness: 0.94,
      metalness: 0.02,
      vertexColors: true,
    });

    const columnX = INNER_FACE + COLUMN_W / 2;
    let pick = 0;
    const addColumn = (x: number, z: number) => {
      const mesh = new THREE.Mesh(columnGeometries[pick++ % columnGeometries.length], concreteMaterial);
      mesh.position.set(x, 0, z);
      scene.add(mesh);
    };
    for (let i = 0; i < INNER_ROW; i++) {
      const z = INNER_Z_NEAR - i * COLUMN_STEP;
      addColumn(-columnX, z);
      addColumn(columnX, z);
    }
    for (let i = 0; i < OUTER_ROW; i++) {
      // Offset by half a bay so the outer row shows through the gaps.
      const z = INNER_Z_NEAR - COLUMN_STEP / 2 - i * COLUMN_STEP * 1.6;
      addColumn(-OUTER_X, z);
      addColumn(OUTER_X, z);
    }

    /* -- floor: slightly polished, tinted with the same noise -- */
    const floorGeometry = new THREE.PlaneGeometry(FLOOR_W, FLOOR_D, 16, 28);
    floorGeometry.rotateX(-Math.PI / 2);
    tintConcrete(floorGeometry, rng, tuning.concreteTint * 0.6, 4);
    const floor = new THREE.Mesh(
      floorGeometry,
      new THREE.MeshStandardMaterial({
        color: tuning.floor,
        roughness: tuning.floorRoughness,
        metalness: tuning.floorMetalness,
        vertexColors: true,
      }),
    );
    floor.position.z = -FLOOR_D / 2 + 20;
    scene.add(floor);

    /* -- base uplights: one merged additive buffer for every column -- */
    const uplightTint = new THREE.Color(tuning.uplight);
    const glow = new GlowBuilder();
    for (let i = 0; i < INNER_ROW; i++) {
      const z = INNER_Z_NEAR - i * COLUMN_STEP;
      if (z < -27) break; // beyond this the fog swallows them
      for (const sign of [-1, 1]) {
        const x = sign * (INNER_FACE - 0.015);
        const halfBay = 0.72;
        // A vertical gradient ribbon washing up the inner face...
        const stops: Array<[number, number]> = [
          [0, 0.85],
          [0.8, 1],
          [2.2, 0.26],
          [4.2, 0],
        ];
        for (let s = 0; s < stops.length - 1; s++) {
          const [y0, a0] = stops[s];
          const [y1, a1] = stops[s + 1];
          glow.quad(
            [x, y0, z - halfBay],
            [x, y0, z + halfBay],
            [x, y1, z - halfBay],
            [x, y1, z + halfBay],
            a0,
            a1,
            uplightTint,
          );
        }
        // ...and the spill it throws onto the slab in front of it.
        glow.disc(sign * (INNER_FACE - 0.55), z, 1.7, 1.2, 0.6, uplightTint);
      }
    }
    const uplightMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: tuning.uplightGain * props.uplight,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    });
    if (!glow.empty) {
      const uplights = new THREE.Mesh(glow.build(), uplightMaterial);
      uplights.frustumCulled = false;
      uplights.renderOrder = 5;
      scene.add(uplights);
    }

    /* -- floor pools, one per beam, plus a stretched reflection -- */
    const poolMaterial = buildPoolMaterial(shared, tuning);
    const poolGeometry = new THREE.PlaneGeometry(1, 1);
    poolGeometry.rotateX(-Math.PI / 2);
    for (const beam of tuning.beams) {
      const [bx, , bz] = beam.b;
      const pool = new THREE.Mesh(poolGeometry, poolMaterial);
      pool.position.set(bx, 0.03, bz);
      pool.scale.set(beam.width * 3.6, 1, beam.width * 4.6);
      pool.renderOrder = 6;
      scene.add(pool);

      // The reflection is the same gradient stretched toward the camera and
      // laid almost flat on the slab — enough to read as a wet sheen.
      const reflection = new THREE.Mesh(poolGeometry, poolMaterial);
      reflection.position.set(bx, 0.02, bz + beam.width * 5.5);
      reflection.scale.set(beam.width * 1.5, 1, beam.width * 12);
      reflection.renderOrder = 6;
      scene.add(reflection);
    }

    /* -- the beams themselves: stacked billboards, widest layer first -- */
    for (const beam of tuning.beams) {
      const layers = tuning.layers;
      for (let i = 0; i < layers; i++) {
        const k = layers === 1 ? 0 : i / (layers - 1);
        // The widest layer is the soft halo; the narrower ones stack the core.
        const widthScale = 1 - 0.62 * k;
        const gain = 0.36 - 0.1 * k;
        const softness = 1.6 - 0.5 * k;
        scene.add(buildBeamQuad(beam, shared, tuning, widthScale, gain, softness));
      }
    }

    /* -- dust -- */
    const builtDust = props.dust;
    const dustCount = Math.round(THREE.MathUtils.clamp(620 * builtDust * tuning.dustScale, 0, 900));
    const sprite = makeDustSprite();
    if (dustCount > 0) scene.add(buildDust(dustCount, shared, tuning, sprite, rng));

    /* ---------------------------------------------------------------- *
     * Camera: a fixed upward pitch, a distance that fits the composition
     * to any aspect ratio, and a 40-second drift phase-locked to HERO_T.
     * The path stays inside the corridor slab (|x| < INNER_FACE) and well
     * behind the beam, so it can neither clip a column nor enter the light.
     * ---------------------------------------------------------------- */
    const DRIFT_X = 0.45;
    const DRIFT_Z = 1.2;
    const DRIFT_Y = 0.1;

    function placeCamera(t: number): void {
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const aspect = camera.aspect > 0.01 ? camera.aspect : 1;
      // "Contain" fit at the beam plane: an interior must never crop its own
      // subject, so narrow viewports pull back instead of cropping.
      const distance = Math.max(FIT_H_HALF / tanHalf, FIT_W_HALF / (tanHalf * aspect));
      const baseZ = Math.max(8, distance + REF_Z);

      const phase = ((t - HERO_T) / DOLLY_PERIOD) * Math.PI * 2;
      // Every offset is zero at phase 0, so t = HERO_T is exactly the pose
      // the thumbnail and the reduced-motion still frame capture.
      const x = Math.sin(phase) * DRIFT_X;
      const y = CAM_Y + Math.sin(phase * 2) * DRIFT_Y;
      const z = baseZ - (1 - Math.cos(phase)) * DRIFT_Z;

      camera.position.set(x, y, z);
      // Fixed pitch: aim along a constant direction rather than at a point,
      // so the framing does not tumble when the fit distance changes.
      camera.lookAt(x * 0.6, y + TAN_PITCH * 20, z - 20);
      camera.updateProjectionMatrix();
    }

    let clock = 0;
    let dolly = props.dolly;
    let uplightStrength = props.uplight;
    placeCamera(dolly > 0 ? clock : HERO_T);

    return {
      update(_elapsed: number, dt: number) {
        shared.uTime.value += dt;
        clock += dt * dolly;
        // dolly = 0 parks the camera on the hero pose rather than wherever it
        // happened to be — the prop is documented as a locked hero pose.
        placeCamera(dolly > 0 ? clock : HERO_T);
      },
      applyProps(next: PropValues) {
        if (next.dust !== builtDust) return false; // particle count is baked in
        shared.uIntensity.value = next.intensity;
        fog.density = tuning.fog * next.haze;
        shared.uFogDensity.value = fog.density;
        dolly = next.dolly;
        if (next.uplight !== uplightStrength) {
          uplightStrength = next.uplight;
          uplightMaterial.opacity = tuning.uplightGain * uplightStrength;
        }
        placeCamera(dolly > 0 ? clock : HERO_T);
        return true;
      },
      dispose() {
        // The harness walks the scene graph for geometries and materials; the
        // sprite lives in a uniform and the background/fog are scene state.
        sprite.dispose();
        scene.background = null;
        scene.fog = null;
      },
    };
  },
};

export default basilica;
