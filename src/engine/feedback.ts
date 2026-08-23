/**
 * FeedbackBuffer — a ping-pong density field on the GPU.
 *
 * Two half-resolution render targets take turns. Each step does:
 *
 *   1. decay/advect — sample the previous target, drift it slightly upward
 *      with a noise-warped offset, multiply it down, write into the next one,
 *   2. splat — additively draw the owner's particle system into the same
 *      target as ONE `THREE.Points` draw call (never per-particle sprites),
 *   3. swap.
 *
 * The result is a persistent, slowly dissipating trail: a few thousand cheap
 * point splats accumulate into continuous ink over a few dozen frames, which
 * no per-frame particle system can fake.
 *
 * What lives in the targets is DENSITY, not colour: both targets and the
 * splat sprite are `NoColorSpace`, nothing here knows what ink looks like.
 * The owner maps density → colour in its own composite shader.
 *
 * Precision: half-float when the GPU can render and filter it, otherwise
 * 8-bit unsigned with a screen-space dither in the decay pass — without the
 * dither, `density * 0.995` rounds back to `density` at low values and the
 * dissipation tail freezes into hard bands that never fade.
 */
import * as THREE from "three";

export interface FeedbackOptions {
  /** Number of splat particles. Fixed for the lifetime of the buffer. */
  count: number;
  /** Per-frame (at 60Hz) survival multiplier, ~0.99–0.999. */
  decay?: number;
  /** Upward drift of the field, in UV units per second. */
  rise?: number;
  /** Lateral noise warp of the drift, in UV units per second. */
  swirl?: number;
  /** Resolution scale against the drawing buffer. */
  resolutionScale?: number;
  /** Multiplies every splat's strength. */
  density?: number;
}

const MAX_EDGE = 1024;
/** Short-edge resolution at which one diffusion tap is exactly one texel. */
const DIFFUSION_REFERENCE = 384;
/** Simulation steps are clamped so a stalled tab cannot blow up the field. */
const MAX_DT = 1 / 30;

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const DECAY_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uPrev;
  uniform vec2 uTexel;
  uniform float uFade;
  uniform float uRise;
  uniform float uSwirl;
  uniform float uTime;
  uniform float uDither;
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
    // Sample from below-and-sideways: the content moves up and wanders.
    float warp = vnoise(vUv * 5.0 + vec2(0.0, uTime * 0.08)) - 0.5;
    vec2 src = vUv - vec2(warp * uSwirl, uRise);

    // A 5-tap cross doubles as the diffusion term: ink bleeds outward as it
    // fades, which is what turns discrete splats into a continuous plume.
    float c = texture2D(uPrev, src).r;
    float n = texture2D(uPrev, src + vec2(0.0, uTexel.y)).r;
    float s = texture2D(uPrev, src - vec2(0.0, uTexel.y)).r;
    float e = texture2D(uPrev, src + vec2(uTexel.x, 0.0)).r;
    float w = texture2D(uPrev, src - vec2(uTexel.x, 0.0)).r;
    float v = mix(c, (n + s + e + w) * 0.25, 0.12) * uFade;

    // 8-bit path only: break the quantization step so the tail keeps fading.
    v += (hash21(gl_FragCoord.xy + uTime) - 0.5) * uDither * (1.0 / 255.0);

    gl_FragColor = vec4(max(v, 0.0), 0.0, 0.0, 1.0);
  }
`;

const SPLAT_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aStrength;
  uniform float uPixelScale;
  uniform float uDensity;
  varying float vStrength;
  void main() {
    vStrength = aStrength * uDensity;
    gl_PointSize = max(aSize * uPixelScale, 1.0);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const SPLAT_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uSprite;
  varying float vStrength;
  void main() {
    float a = texture2D(uSprite, gl_PointCoord).r * vStrength;
    if (a <= 0.0) discard;
    gl_FragColor = vec4(a, 0.0, 0.0, 1.0);
  }
`;

/** 64px radial falloff, generated at runtime — zero assets. */
function makeSplatTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  // Density, not colour: never let the renderer sRGB-decode this.
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

export class FeedbackBuffer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly opts: Required<FeedbackOptions>;

  private targetA: THREE.WebGLRenderTarget;
  private targetB: THREE.WebGLRenderTarget;

  /**
   * Both passes live in ONE scene: the opaque decay quad draws first, the
   * additive splat points second (three renders opaque before transparent).
   * Two `render()` calls per step cost measurably more than one, and this
   * loop runs ~90 times inside a single `create()`.
   */
  private readonly fieldScene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private readonly quadGeometry: THREE.BufferGeometry;
  private readonly decayMaterial: THREE.ShaderMaterial;
  private readonly splatMaterial: THREE.ShaderMaterial;
  private readonly splatGeometry: THREE.BufferGeometry;
  private readonly splatTexture: THREE.Texture;

  /** Splat positions in clip space: x,y in [-1,1], z ignored. */
  readonly positions: Float32Array;
  /** Splat diameters, in units of the buffer's short edge. */
  readonly sizes: Float32Array;
  /** Per-splat additive strength. */
  readonly strengths: Float32Array;

  private width = 1;
  private height = 1;
  private time = 0;
  private disposed = false;
  private readonly halfFloat: boolean;

  constructor(renderer: THREE.WebGLRenderer, options: FeedbackOptions) {
    this.renderer = renderer;
    this.opts = {
      count: options.count,
      decay: options.decay ?? 0.995,
      rise: options.rise ?? 0.02,
      swirl: options.swirl ?? 0.004,
      resolutionScale: options.resolutionScale ?? 0.5,
      density: options.density ?? 1,
    };
    this.halfFloat = FeedbackBuffer.supportsHalfFloat(renderer);

    const size = this.computeSize();
    this.width = size.x;
    this.height = size.y;
    this.targetA = this.createTarget();
    this.targetB = this.createTarget();

    this.quadGeometry = new THREE.PlaneGeometry(2, 2);
    this.decayMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uPrev: { value: null },
        uTexel: { value: this.diffusionOffset() },
        uFade: { value: 1 },
        uRise: { value: 0 },
        uSwirl: { value: 0 },
        uTime: { value: 0 },
        uDither: { value: this.halfFloat ? 0 : 1 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: DECAY_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(this.quadGeometry, this.decayMaterial);
    quad.frustumCulled = false;
    quad.renderOrder = 0;
    this.fieldScene.add(quad);

    const count = Math.max(1, Math.floor(this.opts.count));
    this.positions = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.strengths = new Float32Array(count);
    this.splatGeometry = new THREE.BufferGeometry();
    this.splatGeometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.splatGeometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));
    this.splatGeometry.setAttribute("aStrength", new THREE.BufferAttribute(this.strengths, 1));
    this.splatTexture = makeSplatTexture();
    this.splatMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uSprite: { value: this.splatTexture },
        // Short edge: splat radii are authored relative to the smaller
        // dimension, so a portrait viewport gets finer ink rather than
        // splats that are huge relative to its width.
        uPixelScale: { value: Math.min(this.width, this.height) },
        uDensity: { value: this.opts.density },
      },
      vertexShader: SPLAT_VERT,
      fragmentShader: SPLAT_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(this.splatGeometry, this.splatMaterial);
    points.frustumCulled = false;
    points.renderOrder = 1;
    this.fieldScene.add(points);

    this.clear();
  }

  /**
   * Half-float targets need to be colour-renderable AND linearly filterable.
   * On WebGL2 `RGBA16F` filtering is core, on WebGL1 it needs the extension.
   * Anything missing → 8-bit + dither.
   */
  private static supportsHalfFloat(renderer: THREE.WebGLRenderer): boolean {
    const ext = renderer.extensions;
    const isWebGL2 = renderer.capabilities.isWebGL2;
    const renderable = isWebGL2
      ? !!ext.get("EXT_color_buffer_float") || !!ext.get("EXT_color_buffer_half_float")
      : !!ext.get("OES_texture_half_float");
    const filterable = isWebGL2 || !!ext.get("OES_texture_half_float_linear");
    return renderable && filterable;
  }

  /** Half of the drawing buffer, long edge clamped, never zero. */
  private computeSize(): THREE.Vector2 {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    let w = size.x * this.opts.resolutionScale;
    let h = size.y * this.opts.resolutionScale;
    const long = Math.max(w, h);
    if (long > MAX_EDGE) {
      const k = MAX_EDGE / long;
      w *= k;
      h *= k;
    }
    return new THREE.Vector2(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h)));
  }

  /**
   * Diffusion tap offset. Fixed in UV, not in texels: a retina drawing
   * buffer would otherwise blur a smaller *fraction* of the field per step
   * and the same scene would read thinner on a high-DPI screen than on a
   * low-DPI one. Isotropic in pixels, so the blur stays round.
   */
  private diffusionOffset(): THREE.Vector2 {
    const p = Math.max(1, Math.min(this.width, this.height) / DIFFUSION_REFERENCE);
    return new THREE.Vector2(p / this.width, p / this.height);
  }

  private createTarget(): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(this.width, this.height, {
      type: this.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    return target;
  }

  /** The texture holding the current field. Changes identity on every step. */
  get texture(): THREE.Texture {
    return this.targetA.texture;
  }

  /** Aspect ratio of the field, for aspect-correct CPU advection. */
  get aspect(): number {
    return this.width / this.height;
  }

  get usesHalfFloat(): boolean {
    return this.halfFloat;
  }

  set density(value: number) {
    this.splatMaterial.uniforms.uDensity.value = value;
  }

  /** Per-frame (60Hz) survival multiplier. */
  set decay(value: number) {
    this.opts.decay = THREE.MathUtils.clamp(value, 0.5, 0.9999);
  }

  set rise(value: number) {
    this.opts.rise = value;
  }

  /** Upload the splat attributes written by the owner. */
  markSplatsDirty(): void {
    const g = this.splatGeometry;
    g.getAttribute("position").needsUpdate = true;
    g.getAttribute("aSize").needsUpdate = true;
    g.getAttribute("aStrength").needsUpdate = true;
  }

  /** Advance the field one step: decay/advect → splat → swap. */
  step(dt: number): void {
    if (this.disposed) return;
    const clamped = Math.min(Math.max(dt, 0), MAX_DT);
    this.time += clamped;

    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;

    const u = this.decayMaterial.uniforms;
    u.uPrev.value = this.targetA.texture;
    // Frame-rate independent: `decay` is authored per 60Hz frame.
    u.uFade.value = Math.pow(this.opts.decay, clamped * 60);
    u.uRise.value = this.opts.rise * clamped;
    u.uSwirl.value = this.opts.swirl * clamped;
    u.uTime.value = this.time;

    renderer.autoClear = false;
    renderer.setRenderTarget(this.targetB);
    // No clear: the decay pass writes every pixel of the target opaquely.
    renderer.render(this.fieldScene, this.camera);

    // Restore before returning: the caller owns the default framebuffer.
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;

    const swap = this.targetA;
    this.targetA = this.targetB;
    this.targetB = swap;
  }

  /** Wipe both targets to zero density. */
  clear(): void {
    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 1);
    for (const target of [this.targetA, this.targetB]) {
      renderer.setRenderTarget(target);
      renderer.clear(true, false, false);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
  }

  /**
   * Reallocate for the current drawing-buffer size. Contents are lost; the
   * owner re-warms afterwards. Returns false when nothing changed, so the
   * owner can skip the re-warm.
   */
  resize(): boolean {
    if (this.disposed) return false;
    const size = this.computeSize();
    if (size.x === this.width && size.y === this.height) return false;
    this.width = size.x;
    this.height = size.y;
    this.targetA.setSize(this.width, this.height);
    this.targetB.setSize(this.width, this.height);
    this.decayMaterial.uniforms.uTexel.value.copy(this.diffusionOffset());
    this.splatMaterial.uniforms.uPixelScale.value = Math.min(this.width, this.height);
    this.clear();
    return true;
  }

  /**
   * Rebuild after a context restore. The GPU dropped both targets, so the
   * old ones are unusable regardless of their JS state; the owner re-warms.
   */
  rebuild(): void {
    if (this.disposed) return;
    this.targetA.dispose();
    this.targetB.dispose();
    const size = this.computeSize();
    this.width = size.x;
    this.height = size.y;
    this.targetA = this.createTarget();
    this.targetB = this.createTarget();
    this.decayMaterial.uniforms.uTexel.value.copy(this.diffusionOffset());
    this.splatMaterial.uniforms.uPixelScale.value = Math.min(this.width, this.height);
    this.splatTexture.needsUpdate = true;
    this.markSplatsDirty();
    this.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.targetA.dispose();
    this.targetB.dispose();
    this.quadGeometry.dispose();
    this.splatGeometry.dispose();
    this.decayMaterial.dispose();
    this.splatMaterial.dispose();
    this.splatTexture.dispose();
    this.fieldScene.clear();
  }
}
