/**
 * Paper Relief — a layered cut-paper mountain diorama for a light-mode hero.
 *
 * Everything on screen is flat paper: closed 2D contours stacked along z,
 * drawn with opaque `MeshBasicMaterial`. There are no lights, no shadow maps,
 * no postprocessing and no textures — the look is carried entirely by
 * silhouette and palette, which is also what keeps it cheap at DPR 2.
 *
 *  1. a gradient sky backdrop (one plane, vertex-colored top → horizon),
 *  2. 8 ridge layers, back to front: each is a ridge profile sampled at
 *     strictly monotone-increasing x and displaced in y only (`fbm2`), then
 *     closed downward and triangulated with `ShapeGeometry`. Sampling x
 *     monotonically is what guarantees the polygon is simple — a function
 *     graph closed by its own baseline can never self-intersect,
 *  3. contact shadows: a thin dark gradient ribbon *parented to* each layer's
 *     top edge, emitted only where the layer behind actually rises above it.
 *     Parenting is deliberate — a shadow drawn as a sibling would drift off
 *     its layer as soon as parallax moves them at different rates,
 *  4. paper clouds (flat-bottomed scalloped shapes), gliding V-shaped birds,
 *     and foreground firs/bushes parented to the nearest ridge.
 *
 * Depth is faked honestly: layers really do sit at different z, and each one
 * is scaled by `(camZ - z) / camZ` so it covers exactly the same screen area
 * it would at z = 0. Lateral drift is then applied in unscaled world units,
 * so the perspective divide produces true parallax for free — near layers
 * sweep, far ridges barely move.
 *
 * All stochastic placement runs through a seeded PRNG, so the thumbnail and
 * the reduced-motion still frame are reproducible.
 */
import * as THREE from "three";
import { fbm2 } from "../../engine/noise";
import { createRng, hashSeed, type Rng } from "../../engine/rng";
import type { PropValues, RecipeMeta, SceneContext } from "../../engine/types";

/* ------------------------------------------------------------------ *
 * Stage — authored in world units on the z = 0 reference plane; the
 * camera is dollied every frame to "cover" this box, so the framing (and
 * the calm upper-left headline zone) survives any viewport aspect ratio.
 * ------------------------------------------------------------------ */
const FIT_WIDTH = 13.6;
const FIT_HEIGHT = 7.6;
const CENTER_Y = -0.2;
/** Contours run far wider than the fit box: drift and extreme aspect ratios
 *  must never expose a paper edge. */
const X_MIN = -16;
const X_MAX = 16;
const Y_BOTTOM = -9;
const SAMPLES = 260;
const LAYERS = 8;
/** Base z-gap between layers, multiplied by the `depth` prop. */
const Z_STEP = 0.55;

/* ------------------------------------------------------------------ *
 * Palettes
 * ------------------------------------------------------------------ */

interface Palette {
  skyTop: number;
  skyHorizon: number;
  /** Ridge base colors, farthest first. */
  ridges: number[];
  paper: number;
  paperShade: number;
  shadow: number;
  /** Night-only sky furniture. */
  stars?: boolean;
}

interface Tuning {
  palette: Palette;
  speed: number;
  clouds: number;
  birds: number;
  /** Extra amplitude multiplier baked into the variant's terrain. */
  relief: number;
}

const ALPINE: Palette = {
  skyTop: 0xbcdcf0,
  skyHorizon: 0xdff0f6,
  ridges: [0xa9c6e2, 0x8fb4d8, 0x6f9dc4, 0x4a90a8, 0x8ab285, 0x6f9f6a, 0xa8bf88, 0xd5d9a8],
  paper: 0xf6efe2,
  paperShade: 0xe2dbcb,
  shadow: 0x2f4a52,
};

const COAST: Palette = {
  skyTop: 0xc4e6ee,
  skyHorizon: 0xf1f4e4,
  ridges: [0xa9cfdc, 0x86bccb, 0x59a7b8, 0x2f8fa3, 0xdcd0ab, 0xcbb790, 0xe4d7b3, 0xf1e7cd],
  paper: 0xfbf5e8,
  paperShade: 0xe6dcc6,
  shadow: 0x2c5560,
};

const DUNE: Palette = {
  skyTop: 0xf3d6b8,
  skyHorizon: 0xfceedb,
  ridges: [0xe9bd9d, 0xdfa585, 0xd18e6c, 0xbf7a58, 0xd9a173, 0xe5b98c, 0xefcfa5, 0xf7e4c4],
  paper: 0xfdf3e2,
  paperShade: 0xecd9bd,
  shadow: 0x6b3d29,
};

const NIGHT: Palette = {
  skyTop: 0x172a4c,
  skyHorizon: 0x33517c,
  ridges: [0x3d5c86, 0x33507a, 0x2a4468, 0x223956, 0x1e3350, 0x1a2c44, 0x182739, 0x16202e],
  paper: 0xe8e6dc,
  paperShade: 0xc9c8c0,
  shadow: 0x050a14,
  stars: true,
};

function tuningFor(variant: string): Tuning {
  switch (variant) {
    case "coast":
      return { palette: COAST, speed: 0.85, clouds: 3, birds: 3, relief: 0.85 };
    case "dune":
      return { palette: DUNE, speed: 0.7, clouds: 2, birds: 2, relief: 0.7 };
    case "night":
      return { palette: NIGHT, speed: 0.55, clouds: 2, birds: 2, relief: 1.05 };
    default:
      return { palette: ALPINE, speed: 1, clouds: 3, birds: 4, relief: 1 };
  }
}

/* ------------------------------------------------------------------ *
 * Contour generation
 * ------------------------------------------------------------------ */

interface LayerCfg {
  baseY: number;
  amp: number;
  freq: number;
  /** 0 = rolling hills, 1 = sharp ridged peaks. */
  sharp: number;
  /** Height of the broad summit hump, biased right of centre. */
  hump: number;
}

/** Back-to-front layer shapes: tall sharp peaks receding to gentle foreground. */
const LAYER_CFG: LayerCfg[] = [
  // Summits stay under y ≈ 2.4: on ultra-wide viewports the cover fit trades
  // vertical range for width, and the tallest ridge must survive that crop.
  { baseY: 0.62, amp: 1.02, freq: 0.3, sharp: 1.0, hump: 0.8 },
  { baseY: 0.44, amp: 0.94, freq: 0.34, sharp: 0.82, hump: 0.6 },
  { baseY: 0.1, amp: 0.72, freq: 0.38, sharp: 0.58, hump: 0.34 },
  { baseY: -0.4, amp: 0.56, freq: 0.44, sharp: 0.34, hump: 0.14 },
  { baseY: -0.95, amp: 0.46, freq: 0.3, sharp: 0.1, hump: 0.0 },
  { baseY: -1.55, amp: 0.42, freq: 0.25, sharp: 0.0, hump: 0.0 },
  { baseY: -2.2, amp: 0.36, freq: 0.21, sharp: 0.0, hump: 0.0 },
  { baseY: -2.95, amp: 0.3, freq: 0.17, sharp: 0.0, hump: 0.0 },
];

interface Profile {
  xs: Float32Array;
  ys: Float32Array;
}

/**
 * Sample one ridge profile. x advances by a fixed step with bounded jitter
 * (always < step / 3), so x is *strictly* increasing with a guaranteed
 * minimum spacing; only y is displaced. That is the whole self-intersection
 * guarantee — the profile stays a function graph.
 */
function buildProfile(cfg: LayerCfg, rng: Rng, rugged: number, relief: number): Profile {
  const xs = new Float32Array(SAMPLES);
  const ys = new Float32Array(SAMPLES);
  const step = (X_MAX - X_MIN) / (SAMPLES - 1);
  const jitter = step * 0.3;
  // Two independent noise lanes so no two layers share a silhouette.
  const rowU = rng.range(0, 64);
  const rowV = rng.range(0, 64);
  const amp = cfg.amp * rugged * relief;

  for (let i = 0; i < SAMPLES; i++) {
    const x = X_MIN + i * step + (i === 0 || i === SAMPLES - 1 ? 0 : rng.signed(jitter));
    const n = fbm2(x * cfg.freq + rowU, rowV, 4);
    // Ridged noise (|2n-1| folded) gives paper-cut peaks; plain fbm rolls.
    const ridged = 1 - Math.abs(n * 2 - 1);
    const shaped = cfg.sharp * (ridged - 0.5) + (1 - cfg.sharp) * (n - 0.5);
    const hump = cfg.hump * Math.exp(-Math.pow((x - 3.2) / 4.2, 2));
    xs[i] = x;
    ys[i] = cfg.baseY + shaped * 2 * amp + hump * rugged;
  }
  return { xs, ys };
}

/** Linear lookup along a monotone-x profile. */
function heightAt(p: Profile, x: number): number {
  const n = p.xs.length;
  if (x <= p.xs[0]) return p.ys[0];
  if (x >= p.xs[n - 1]) return p.ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - p.xs[lo]) / (p.xs[hi] - p.xs[lo]);
  return p.ys[lo] + (p.ys[hi] - p.ys[lo]) * t;
}

/** Closed paper sheet: the profile, then straight down and back along the base. */
function profileGeometry(p: Profile): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(p.xs[0], p.ys[0]);
  for (let i = 1; i < p.xs.length; i++) shape.lineTo(p.xs[i], p.ys[i]);
  shape.lineTo(X_MAX, Y_BOTTOM);
  shape.lineTo(X_MIN, Y_BOTTOM);
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape);
  // Cheap paper shading: one vertex-colour ramp darkening toward the base.
  // MeshBasicMaterial multiplies this by material.color, so the palette stays
  // live-tweakable without touching the buffer.
  const pos = geometry.getAttribute("position");
  const shade = new Float32Array(pos.count * 3);
  let top = -Infinity;
  for (let i = 0; i < p.ys.length; i++) top = Math.max(top, p.ys[i]);
  for (let i = 0; i < pos.count; i++) {
    const drop = THREE.MathUtils.clamp((top - pos.getY(i)) / 3.4, 0, 1);
    const b = 1 - 0.12 * drop;
    shade[i * 3] = b;
    shade[i * 3 + 1] = b;
    shade[i * 3 + 2] = b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(shade, 3));
  return geometry;
}

/**
 * Contact shadow cast by this layer onto the one behind it. Quads are emitted
 * only where the layer behind rises above this profile, and the ribbon height
 * is clamped to that gap — so no shadow ever smudges into open sky.
 * Returns null when the layer behind is hidden everywhere (nothing to catch it).
 */
function shadowRibbon(front: Profile, behind: Profile, height: number, strength: number, tint: THREE.Color) {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];

  for (let i = 0; i < front.xs.length - 1; i++) {
    const x0 = front.xs[i];
    const x1 = front.xs[i + 1];
    const y0 = front.ys[i];
    const y1 = front.ys[i + 1];
    const gap0 = heightAt(behind, x0) - y0;
    const gap1 = heightAt(behind, x1) - y1;
    if (gap0 <= 0.02 && gap1 <= 0.02) continue;
    const h0 = Math.min(height, Math.max(gap0, 0));
    const h1 = Math.min(height, Math.max(gap1, 0));
    const base = pos.length / 3;
    pos.push(x0, y0, 0, x1, y1, 0, x0, y0 + h0, 0, x1, y1 + h1, 0);
    const a0 = h0 > 0 ? strength : 0;
    const a1 = h1 > 0 ? strength : 0;
    col.push(
      tint.r, tint.g, tint.b, a0,
      tint.r, tint.g, tint.b, a1,
      tint.r, tint.g, tint.b, 0,
      tint.r, tint.g, tint.b, 0,
    );
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  if (idx.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  // itemSize 4 switches three.js to vertex alpha — the gradient needs no shader.
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  geometry.setIndex(idx);

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

/* ------------------------------------------------------------------ *
 * Small paper props — convex pieces merged into one buffer each, so a
 * bush or a fir costs a single draw call.
 * ------------------------------------------------------------------ */

class PolyBuilder {
  private pos: number[] = [];
  private idx: number[] = [];

  /** Fan-triangulates a convex polygon. */
  addConvex(points: number[][]): void {
    const base = this.pos.length / 3;
    for (const [x, y] of points) this.pos.push(x, y, 0);
    for (let i = 1; i < points.length - 1; i++) this.idx.push(base, base + i, base + i + 1);
  }

  addCircle(cx: number, cy: number, r: number, segments = 14): void {
    const pts: number[][] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    this.addConvex(pts);
  }

  addRect(x0: number, y0: number, x1: number, y1: number): void {
    this.addConvex([
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    geometry.setIndex(this.idx);
    return geometry;
  }

  get empty(): boolean {
    return this.idx.length === 0;
  }
}

function paperMaterial(color: THREE.Color | number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
}

/** Flat-bottomed scalloped cloud: tangent upper semicircles over a base line. */
function cloudGeometry(rng: Rng): THREE.BufferGeometry {
  const bumps = rng.int(3, 4);
  const radii: number[] = [];
  for (let i = 0; i < bumps; i++) radii.push(rng.range(0.1, 0.24));
  // Biggest bump in the middle reads most like a paper cloud.
  radii.sort((a, b) => b - a);
  const order = [...radii.slice(2).reverse(), radii[0], radii[1]];

  const shape = new THREE.Shape();
  let cx = 0;
  const centers: number[] = [];
  for (let i = 0; i < order.length; i++) {
    if (i > 0) cx += order[i - 1] + order[i]; // tangent, never overlapping
    centers.push(cx);
  }
  shape.moveTo(centers[0] - order[0], 0);
  for (let i = 0; i < order.length; i++) {
    // clockwise=true sweeps PI → 0 the short way: the *upper* semicircle.
    shape.absarc(centers[i], 0, order[i], Math.PI, 0, true);
  }
  shape.lineTo(centers[0] - order[0], 0);
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape, 10);
  // Recentre so drift maths can treat the cloud as a point.
  geometry.center();
  return geometry;
}

/** Flat paper bird: a thickened V, concave, so it goes through ShapeGeometry. */
function birdGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const pts: number[][] = [
    [-1, 0.34],
    [-0.12, -0.06],
    [0, 0.03],
    [0.12, -0.06],
    [1, 0.34],
    [0.5, 0.02],
    [0, -0.16],
    [-0.5, 0.02],
  ];
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/* ------------------------------------------------------------------ *
 * Recipe
 * ------------------------------------------------------------------ */

interface Layer {
  group: THREE.Group;
  material: THREE.MeshBasicMaterial;
  base: THREE.Color;
  /** 0 = nearest. Drives z, parallax rate and haze. */
  depthIndex: number;
  driftAmp: number;
  driftRate: number;
  phase: number;
}

interface Floater {
  object: THREE.Object3D;
  depthIndex: number;
  x: number;
  y: number;
  speed: number;
  phase: number;
  /** Birds flap; clouds do not. */
  flap: boolean;
}

const paperRelief: RecipeMeta = {
  slug: "paper-relief",
  title: "Paper Relief",
  category: "landing",
  description:
    "A light-mode landing hero built as a cut-paper diorama: eight ridge contours sampled at monotone x with fBm displacement, stacked in z as opaque paper sheets. Contact shadows are gradient ribbons parented to each layer's top edge (no shadow maps), perspective scale compensation turns z-spacing into real parallax, and paper clouds, gliding birds and foreground firs finish the craft look. The upper-left stays calm for a headline.",
  tags: ["landing", "hero", "light-mode", "shapegeometry", "parallax"],
  variants: [
    { id: "alpine", label: "Alpine" },
    { id: "coast", label: "Coast" },
    { id: "dune", label: "Dune" },
    { id: "night", label: "Night" },
  ],
  props: [
    { key: "depth", label: "Depth", min: 0.2, max: 2.4, step: 0.05, default: 1 },
    { key: "drift", label: "Drift", min: 0, max: 2.5, step: 0.05, default: 1 },
    { key: "warmth", label: "Warmth", min: -1, max: 1, step: 0.05, default: 0 },
    { key: "ruggedness", label: "Ruggedness", min: 0.2, max: 1.8, step: 0.05, default: 1, rebuild: true },
    { key: "haze", label: "Haze", min: 0, max: 1, step: 0.02, default: 0.3 },
  ],
  /** The clouds and birds need a few seconds to spread across the sky. */
  thumbnailWarmup: 4,

  create({ scene, camera, variant, props }: SceneContext) {
    const tuning = tuningFor(variant);
    const pal = tuning.palette;
    const rng = createRng(hashSeed(`paper-relief:${variant}`));
    const rugged = props.ruggedness;
    const builtRuggedness = rugged;

    const skyTop = new THREE.Color(pal.skyTop);
    const skyHorizon = new THREE.Color(pal.skyHorizon);
    const shadowTint = new THREE.Color(pal.shadow);
    // The harness clears to near-black; a hero in light mode must override it.
    scene.background = skyHorizon.clone();

    const layers: Layer[] = [];
    const floaters: Floater[] = [];

    /* -- sky backdrop: one opaque vertex-coloured plane, behind everything -- */
    const skyGeometry = new THREE.PlaneGeometry(FIT_WIDTH * 2.6, FIT_HEIGHT * 2.6, 1, 8);
    {
      const pos = skyGeometry.getAttribute("position");
      const col = new Float32Array(pos.count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        // Anchor the ramp to the authored composition, clamped beyond it.
        const t = THREE.MathUtils.clamp((pos.getY(i) + CENTER_Y - (CENTER_Y - FIT_HEIGHT / 2)) / FIT_HEIGHT, 0, 1);
        c.copy(skyHorizon).lerp(skyTop, t);
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      }
      skyGeometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
    }
    const skyGroup = new THREE.Group();
    const sky = new THREE.Mesh(
      skyGeometry,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    );
    sky.position.y = CENTER_Y;
    sky.renderOrder = -1;
    skyGroup.add(sky);
    scene.add(skyGroup);
    const skyLayer: Layer = {
      group: skyGroup,
      material: sky.material as THREE.MeshBasicMaterial,
      base: new THREE.Color(0xffffff),
      depthIndex: LAYERS + 1.5,
      driftAmp: 0,
      driftRate: 0,
      phase: 0,
    };

    /* -- moon + stars (night only), pinned just in front of the backdrop -- */
    if (pal.stars) {
      const stars = new PolyBuilder();
      for (let i = 0; i < 46; i++) {
        // Upper-right bias keeps the headline zone quiet.
        const x = rng.range(-5.5, 7.4);
        const y = rng.range(0.4, 3.6);
        if (x < -1.5 && y > 1.6 && rng.next() < 0.75) continue;
        stars.addCircle(x, y, rng.range(0.016, 0.038), 6);
      }
      const starMesh = new THREE.Mesh(stars.build(), paperMaterial(pal.paper));
      const moon = new PolyBuilder();
      moon.addCircle(4.9, 2.7, 0.52, 28);
      const moonMesh = new THREE.Mesh(moon.build(), paperMaterial(pal.paper));
      const shade = new PolyBuilder();
      shade.addCircle(5.06, 2.56, 0.52, 28);
      const shadeMesh = new THREE.Mesh(shade.build(), paperMaterial(pal.paperShade));
      shadeMesh.position.z = -0.001;
      skyGroup.add(starMesh, moonMesh, shadeMesh);
    }

    /* -- clouds -- */
    const cloudMaterial = paperMaterial(pal.paper);
    const cloudShadeMaterial = paperMaterial(pal.paperShade);
    for (let i = 0; i < tuning.clouds; i++) {
      const holder = new THREE.Group();
      const geometry = cloudGeometry(rng);
      const body = new THREE.Mesh(geometry, cloudMaterial);
      // A second sheet peeking out below sells the "two pieces of paper" look.
      const under = new THREE.Mesh(geometry, cloudShadeMaterial);
      under.position.set(0.03, -0.05, -0.001);
      holder.add(under, body);
      const scale = rng.range(0.85, 1.5);
      holder.scale.setScalar(scale);
      const cloudGroup = new THREE.Group();
      cloudGroup.add(holder);
      scene.add(cloudGroup);
      floaters.push({
        object: cloudGroup,
        depthIndex: LAYERS - 0.5,
        // Clouds live right of centre; the upper-left is the headline's.
        x: rng.range(-1.5, 8),
        y: rng.range(1.5, 3.4),
        speed: rng.range(0.05, 0.13),
        phase: rng.range(0, Math.PI * 2),
        flap: false,
      });
    }

    /* -- birds -- */
    const birdGeom = birdGeometry();
    // Birds read as paper only when they are darker than the sky behind them.
    const birdMaterial = paperMaterial(new THREE.Color(pal.ridges[1]).lerp(shadowTint, 0.3));
    for (let i = 0; i < tuning.birds; i++) {
      const bird = new THREE.Mesh(birdGeom, birdMaterial);
      bird.scale.setScalar(rng.range(0.07, 0.12));
      const birdGroup = new THREE.Group();
      birdGroup.add(bird);
      scene.add(birdGroup);
      floaters.push({
        object: birdGroup,
        depthIndex: 3.2,
        x: rng.range(0, 7),
        y: rng.range(1.4, 3.2),
        speed: rng.range(0.24, 0.42),
        phase: rng.range(0, Math.PI * 2),
        flap: true,
      });
    }

    /* -- ridge layers, farthest first -- */
    const profiles: Profile[] = [];
    for (let i = 0; i < LAYERS; i++) {
      profiles.push(buildProfile(LAYER_CFG[i], rng, rugged, tuning.relief));
    }

    for (let i = 0; i < LAYERS; i++) {
      const group = new THREE.Group();
      const material = paperMaterial(pal.ridges[i]);
      material.vertexColors = true;
      const mesh = new THREE.Mesh(profileGeometry(profiles[i]), material);
      mesh.frustumCulled = false;
      group.add(mesh);

      // Contact shadow onto the layer behind — parented, so parallax can
      // never separate it from the edge that casts it.
      if (i > 0) {
        const ribbon = shadowRibbon(profiles[i], profiles[i - 1], 0.34, 0.26, shadowTint);
        if (ribbon) {
          ribbon.renderOrder = 10 + i;
          group.add(ribbon);
        }
      }

      scene.add(group);
      layers.push({
        group,
        material,
        base: new THREE.Color(pal.ridges[i]),
        depthIndex: LAYERS - 1 - i,
        driftAmp: 0.05 + 0.045 * i,
        driftRate: 0.11 + 0.035 * i,
        phase: rng.range(0, Math.PI * 2),
      });
    }

    /* -- foreground paper trees and bushes, parented to the nearest ridge -- */
    {
      const near = profiles[LAYERS - 1];
      const nearGroup = layers[LAYERS - 1].group;
      const foliage = new PolyBuilder();
      const trunks = new PolyBuilder();

      const fir = (x: number, s: number) => {
        const y = heightAt(near, x) - 0.12 * s;
        trunks.addRect(x - 0.035 * s, y - 0.1 * s, x + 0.035 * s, y + 0.34 * s);
        for (let t = 0; t < 3; t++) {
          const w = (0.42 - t * 0.1) * s;
          const y0 = y + (0.18 + t * 0.34) * s;
          foliage.addConvex([
            [x - w, y0],
            [x + w, y0],
            [x, y0 + 0.52 * s],
          ]);
        }
      };
      const bush = (x: number, s: number) => {
        const y = heightAt(near, x) - 0.1 * s;
        foliage.addCircle(x - 0.18 * s, y + 0.14 * s, 0.19 * s, 12);
        foliage.addCircle(x + 0.17 * s, y + 0.12 * s, 0.16 * s, 12);
        foliage.addCircle(x, y + 0.26 * s, 0.22 * s, 14);
      };

      fir(rng.range(4.6, 5.6), rng.range(0.85, 1.15));
      fir(rng.range(-6.2, -5.2), rng.range(0.6, 0.8));
      bush(rng.range(3.4, 4.0), rng.range(0.8, 1.1));
      bush(rng.range(-4.4, -3.6), rng.range(0.6, 0.9));

      const foliageColor = new THREE.Color(pal.ridges[LAYERS - 1]).lerp(shadowTint, 0.45);
      const trunkColor = new THREE.Color(pal.ridges[LAYERS - 1]).lerp(shadowTint, 0.62);
      if (!trunks.empty) nearGroup.add(new THREE.Mesh(trunks.build(), paperMaterial(trunkColor)));
      if (!foliage.empty) nearGroup.add(new THREE.Mesh(foliage.build(), paperMaterial(foliageColor)));
    }

    /* ---------------------------------------------------------------- *
     * Live palette: warmth shifts hue/saturation, haze fades the far
     * ridges toward the horizon colour. Both only touch material.color,
     * so the vertex-colour paper shading survives untouched.
     * ---------------------------------------------------------------- */
    // Temperature is a tint blend, not a hue rotation: rotating a blue ridge
    // toward orange passes through magenta, which no paper stock ever does.
    const WARM_TINT = new THREE.Color(0xffb26b);
    const COOL_TINT = new THREE.Color(0x7fa9dd);
    const scratch = new THREE.Color();

    function applyPalette(warmth: number, haze: number): void {
      for (const layer of layers) {
        scratch.copy(layer.base);
        if (warmth !== 0) {
          const k = Math.min(Math.abs(warmth), 1) * 0.34;
          scratch.lerp(warmth > 0 ? WARM_TINT : COOL_TINT, k);
        }
        const far = layer.depthIndex / (LAYERS - 1);
        scratch.lerp(skyHorizon, Math.pow(far, 1.4) * haze);
        layer.material.color.copy(scratch);
      }
    }

    let warmth = props.warmth;
    let haze = props.haze;
    let depth = props.depth;
    let drift = props.drift;
    applyPalette(warmth, haze);

    /* ---------------------------------------------------------------- *
     * Layout: dolly to cover the authored box, then place every layer at
     * its own z and scale it by (camZ - z) / camZ so it covers exactly the
     * screen area it would at z = 0. Drift is added afterwards in world
     * units, which is what produces the parallax.
     * ---------------------------------------------------------------- */
    let camZ = 10;

    function fitCamera(): void {
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const aspect = camera.aspect > 0.01 ? camera.aspect : 1;
      camZ = Math.min(FIT_HEIGHT / 2 / tanHalf, FIT_WIDTH / 2 / (tanHalf * aspect));
      camera.position.set(0, CENTER_Y, camZ);
      camera.lookAt(0, CENTER_Y, 0);
      camera.updateProjectionMatrix();
    }

    function place(group: THREE.Group, depthIndex: number, offsetX: number, offsetY: number): void {
      const z = -depthIndex * Z_STEP * depth;
      const s = (camZ - z) / camZ;
      group.scale.set(s, s, 1);
      group.position.set(offsetX, CENTER_Y * (1 - s) + offsetY, z);
    }

    function layout(t: number): void {
      fitCamera();
      place(skyLayer.group, skyLayer.depthIndex, 0, 0);
      for (const layer of layers) {
        const dx = Math.sin(t * layer.driftRate + layer.phase) * layer.driftAmp;
        const dy = Math.sin(t * layer.driftRate * 0.63 + layer.phase * 1.7) * 0.022;
        place(layer.group, layer.depthIndex, dx, dy);
      }
      for (const f of floaters) {
        // Wrap through a span wider than any viewport, so nothing pops in.
        const span = 22;
        const x = ((f.x + t * f.speed + span / 2) % span) - span / 2;
        const y = f.y + Math.sin(t * 0.35 + f.phase) * 0.07;
        place(f.object as THREE.Group, f.depthIndex, x, y);
        if (f.flap) {
          const child = f.object.children[0];
          child.scale.y = 1 + 0.42 * Math.sin(t * 2.6 + f.phase);
        }
      }
    }

    let clock = 0;
    layout(clock);

    return {
      update(_elapsed: number, dt: number) {
        clock += dt * drift * tuning.speed;
        layout(clock);
      },
      applyProps(next: PropValues) {
        if (next.ruggedness !== builtRuggedness) return false; // terrain rebuild
        depth = next.depth;
        drift = next.drift;
        if (next.warmth !== warmth || next.haze !== haze) {
          warmth = next.warmth;
          haze = next.haze;
          applyPalette(warmth, haze);
        }
        layout(clock);
        return true;
      },
      dispose() {
        // The harness walks the graph for geometries/materials; the only
        // state that outlives it is the background colour it did not set.
        scene.background = null;
      },
    };
  },
};

export default paperRelief;
