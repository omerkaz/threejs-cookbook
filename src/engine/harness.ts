import * as THREE from "three";
import type { PropValues, RecipeMeta, SceneBuild } from "./types";

export interface MountOptions {
  variant: string;
  props: PropValues;
  /** Devicepixelratio cap; defaults to 2 (mobile GPU safety). */
  maxDpr?: number;
  onFps?(fps: number): void;
  onContextLost?(): void;
}

export interface SceneHandle {
  setProps(props: PropValues): void;
  setVariant(variant: string): void;
  dispose(): void;
}

const SCENE_BG = 0x0a0a0c;
/** Default simulated seconds for the reduced-motion still frame. */
const STILL_FRAME_WARMUP = 1.2;

/** Dispose every geometry/material/texture reachable from `scene`. */
export function disposeSceneGraph(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else if (material) disposeMaterial(material);
  });
  scene.clear();
}

/**
 * Baseline renderer state. A recipe's `preRender` draws into its own targets
 * and is required to restore this itself; calling it here as well means a
 * buggy recipe can only break its own frame, never the next one.
 */
function restoreRendererState(renderer: THREE.WebGLRenderer): void {
  renderer.setRenderTarget(null);
  renderer.setScissorTest(false);
  renderer.autoClear = true;
  renderer.autoClearColor = true;
  renderer.autoClearDepth = true;
  renderer.autoClearStencil = true;
}

function disposeMaterial(material: THREE.Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}

/**
 * Mounts a recipe onto a canvas: renderer + scene + camera + rAF loop.
 * - StrictMode-safe: dispose() is idempotent and does not force context loss,
 *   so a dev double-mount on the same canvas keeps working.
 * - Respects prefers-reduced-motion by rendering still frames only.
 * - Guards zero-sized containers and reports context loss.
 */
export function mountScene(
  canvas: HTMLCanvasElement,
  recipe: RecipeMeta,
  opts: MountOptions,
): SceneHandle {
  const maxDpr = opts.maxDpr ?? 2;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(SCENE_BG, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);

  let variant = opts.variant;
  let props: PropValues = { ...opts.props };
  let build: SceneBuild | null = null;
  let disposed = false;
  let raf = 0;
  let elapsed = 0;
  let last = performance.now();
  let fpsAccum = 0;
  let fpsFrames = 0;
  let fpsLast = last;

  const reducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const onLost = (event: Event) => {
    event.preventDefault();
    opts.onContextLost?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  function rebuild(): void {
    if (build) {
      build.dispose?.();
      disposeSceneGraph(scene);
      build = null;
    }
    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);
    build = recipe.create({ scene, camera, renderer, variant, props });
  }

  function resize(): void {
    if (disposed) return;
    const parent = canvas.parentElement;
    const w = parent?.clientWidth ?? canvas.clientWidth;
    const h = parent?.clientHeight ?? canvas.clientHeight;
    if (w === 0 || h === 0) return; // hidden or not laid out yet
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function renderFrame(dt: number): void {
    elapsed += dt;
    build?.update?.(elapsed, dt);
    if (build?.preRender) {
      try {
        build.preRender(dt);
      } finally {
        restoreRendererState(renderer);
      }
    }
    renderer.render(scene, camera);
  }

  function loop(now: number): void {
    if (disposed) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    renderFrame(dt);
    fpsAccum += now - fpsLast;
    fpsLast = now;
    fpsFrames += 1;
    if (fpsAccum >= 500) {
      opts.onFps?.(Math.round((fpsFrames * 1000) / fpsAccum));
      fpsAccum = 0;
      fpsFrames = 0;
    }
    raf = requestAnimationFrame(loop);
  }

  const observer = new ResizeObserver(() => {
    resize();
    if (reducedMotion) renderFrame(0);
  });
  if (canvas.parentElement) observer.observe(canvas.parentElement);

  rebuild();
  resize();
  if (reducedMotion) {
    // Advance once so motion-driven scenes show a composed frame.
    renderFrame(recipe.thumbnailWarmup ?? STILL_FRAME_WARMUP);
    opts.onFps?.(0);
  } else {
    raf = requestAnimationFrame(loop);
  }

  return {
    setProps(next: PropValues) {
      if (disposed) return;
      props = { ...next };
      const handled = build?.applyProps?.(props) ?? false;
      if (!handled) rebuild();
      if (reducedMotion) renderFrame(0);
    },
    setVariant(next: string) {
      if (disposed) return;
      if (next === variant) return;
      variant = next;
      rebuild();
      if (reducedMotion) renderFrame(0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      build?.dispose?.();
      disposeSceneGraph(scene);
      // Intentionally no forceContextLoss(): React StrictMode remounts on the
      // same canvas in dev, and a lost context would blank the second mount.
      renderer.dispose();
    },
  };
}
