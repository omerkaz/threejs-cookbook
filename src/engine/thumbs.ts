import * as THREE from "three";
import { disposeSceneGraph } from "./harness";
import { defaultProps, type RecipeMeta } from "./types";

/**
 * Thumbnail service: a single shared WebGL renderer on a hidden canvas
 * renders each recipe once at low resolution and captures a PNG data URL.
 * One context total — grids never approach the browser's WebGL context cap.
 *
 * Capture happens synchronously after render() in the same task, which is
 * safe without preserveDrawingBuffer. Results are cached for the session,
 * so filtering/searching the grid never re-renders thumbnails.
 */

const THUMB_W = 480;
const THUMB_H = 300;
const SCENE_BG = 0x0a0a0c;
/** Default seconds of simulated time so motion-driven scenes compose a lively frame. */
const DEFAULT_WARMUP = 1.6;
/** Fixed step rate for recipes that integrate state in `preRender`. */
const WARMUP_HZ = 45;
const MAX_WARMUP_STEPS = 240;

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const queue: Array<() => void> = [];

let renderer: THREE.WebGLRenderer | null = null;
let draining = false;

function getRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    const canvas = document.createElement("canvas");
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setClearColor(SCENE_BG, 1);
    renderer.setSize(THUMB_W, THUMB_H, false);
  }
  return renderer;
}

/**
 * Recipes share one renderer, so any state a recipe leaves behind (a bound
 * render target, a tone mapping change, autoClear off) would bleed into the
 * next thumbnail. Reset the renderer to a known baseline before every render.
 */
function resetRendererState(r: THREE.WebGLRenderer): void {
  r.setRenderTarget(null);
  r.setScissorTest(false);
  r.setViewport(0, 0, THUMB_W, THUMB_H);
  r.autoClear = true;
  r.autoClearColor = true;
  r.autoClearDepth = true;
  r.autoClearStencil = true;
  r.toneMapping = THREE.NoToneMapping;
  r.toneMappingExposure = 1;
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.setClearColor(SCENE_BG, 1);
  r.clear(true, true, true);
}

function renderThumb(recipe: RecipeMeta, variant: string): string {
  const r = getRenderer();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, THUMB_W / THUMB_H, 0.1, 200);
  camera.position.set(0, 0, 8);
  camera.lookAt(0, 0, 0);
  const build = recipe.create({
    scene,
    camera,
    renderer: r,
    variant,
    props: defaultProps(recipe),
  });
  const warmup = recipe.thumbnailWarmup ?? DEFAULT_WARMUP;
  try {
    if (build.preRender) {
      // Render-target recipes integrate their state: one giant dt would
      // collapse the whole warm-up into a single (clamped) step, so step the
      // simulation at a fixed rate instead. Deterministic either way.
      const steps = THREE.MathUtils.clamp(Math.round(warmup * WARMUP_HZ), 1, MAX_WARMUP_STEPS);
      const dt = 1 / WARMUP_HZ;
      for (let i = 0; i < steps; i++) {
        build.update?.((i + 1) * dt, dt);
        build.preRender(dt);
      }
    } else {
      // Closed-form recipes derive every position from elapsed time, so a
      // single jump composes exactly what that many seconds of frames would.
      build.update?.(warmup, warmup);
    }
    resetRendererState(r);
    r.render(scene, camera);
    return r.domElement.toDataURL("image/png");
  } finally {
    // Whatever happened above — including a throw mid-warm-up — the shared
    // renderer goes back to baseline before the next recipe touches it.
    resetRendererState(r);
    build.dispose?.();
    disposeSceneGraph(scene);
  }
}

function drain(): void {
  if (draining) return;
  const job = queue.shift();
  if (!job) return;
  draining = true;
  // Spread work across frames so the grid stays responsive while warming.
  requestAnimationFrame(() => {
    draining = false;
    job();
    drain();
  });
}

/** Resolves with a PNG data URL for the recipe's default-props first frame. */
export function requestThumbnail(recipe: RecipeMeta, variant?: string): Promise<string> {
  const v = variant ?? recipe.variants[0]?.id ?? "default";
  const key = `${recipe.slug}::${v}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(key);
  if (inflight) return inflight;

  const promise = new Promise<string>((resolve, reject) => {
    queue.push(() => {
      try {
        const url = renderThumb(recipe, v);
        cache.set(key, url);
        pending.delete(key);
        resolve(url);
      } catch (error) {
        pending.delete(key);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    drain();
  });
  pending.set(key, promise);
  return promise;
}
