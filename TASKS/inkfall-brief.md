# Task: Inkfall — fifth landing-page hero recipe (stylize-first, engine feature)

## Goal

Build **Inkfall** — black sumi ink blooming underwater over warm paper — as the
fifth `landing` recipe. Light-mode editorial mood for writing/journal/legal
brands. This is the collection's crown jewel AND its first render-target
feature: you will add a small feedback-buffer system to the engine (Part A)
and then the recipe (Part B).

**Verdict context:** stylize-first — evocative ink, not photoreal fluid sim.
**Art target:** `concepts/01-inkfall.png`. Warm cream paper, ink tendrils
blooming on the RIGHT side, left side calm paper for the headline.

## Read first (in order)

1. `README.md`
2. `src/engine/types.ts`, `harness.ts`, `thumbs.ts`, `rng.ts`, `noise.ts`
3. `src/app/prompt.ts` (buildCode — you will extend it)
4. `src/recipes/scenes/tideline.ts` + one other landing recipe for conventions
5. `TASKS/*-report.md` — prior lessons
6. `concepts/01-inkfall.png`

## Part A — engine: preRender contract + FeedbackBuffer

A dedicated multi-model review vetted this design. Its constraints are law.

### A1. Contract extension

- `SceneContext` gains `renderer: THREE.WebGLRenderer` (update harness AND
  thumbnailer call sites; it's a new required field — fix all usages).
- `SceneBuild` gains optional `preRender?(dt: number): void`, called by the
  harness each frame immediately before the main render, and by the
  thumbnailer during warm-up steps.
- **State invariant:** after `preRender` returns, render target must be null
  and `autoClear` restored. Enforce defensively: harness calls a state restore
  after `preRender`; thumbnailer wraps warm-up + capture in
  `try/finally { resetRendererState() }`.

### A2. `src/engine/feedback.ts` — FeedbackBuffer class

- Ping-pong pair of `WebGLRenderTarget`s. Resolution from
  `renderer.getDrawingBufferSize()` × 0.5, long edge clamped to 1024, every
  dimension `Math.max(1, Math.floor(...))` (zero-size canvas guard).
- **Texture type selection:** try `HalfFloatType` + `LinearFilter` only if the
  required extensions are present (WebGL2: `EXT_color_buffer_float`, plus
  `OES_texture_half_float_linear` for linear filtering; check via
  `renderer.extensions.get(...)`). Fallback: `UnsignedByteType` — and in the
  decay shader add a tiny screen-space dither before writing, or 8-bit
  quantization freezes/bands the decay tail.
- Density is DATA, not color: `texture.colorSpace = THREE.NoColorSpace` on
  both targets and on any canvas splat texture. All paper/sepia/black color
  mapping happens ONLY in the final composite shader.
- Internal fullscreen-quad scene + ortho camera. Per step:
  1. decay/advect pass: sample prev target, multiply by ~0.995, small upward
     noise offset; write to next (manage `renderer.autoClear` yourself —
     save, set false where needed, restore)
  2. splat pass: additively render the ink particle system into next —
     **one draw call** (`THREE.Points` with canvas radial-gradient sprite;
     never per-particle Sprites)
  3. swap
- `step(dt)` clamps `dt` to `min(dt, 1/30)`.
- `resize()`: reallocate both targets (drawing-buffer size), clear, then the
  OWNER re-warms (short: ~45 steps). Debounce resize (~150ms) at the recipe
  level so window-drag doesn't thrash reallocation+rewarm.
- `rebuild()` for context restore: recipe listens for `webglcontextrestored`
  on `renderer.domElement`, calls rebuild + re-warm (contents are lost on
  context loss; without this the hero comes back blank).
- `dispose()`: both targets, pass materials, quad geometry, splat texture.
  After recipe dispose, `renderer.info.memory.textures` must return to its
  prior baseline (verify this).

### A3. Copy-source stitching (`src/app/prompt.ts`)

Generalize the noise-append into an explicit WHITELIST (no import traversal):
`engine/rng.ts`, `engine/noise.ts`, `engine/feedback.ts` — appended in
dependency order, each at most once, only when the recipe source imports them.

## Part B — the Inkfall recipe

`src/recipes/scenes/inkfall.ts`, category `landing`, registered after
Emberworks.

- 1.5–2k CPU particles advected by curl noise (derive from `fbm2` in
  `engine/noise.ts`), seeded via `hashSeed("inkfall:<variant>")`; positions
  uploaded to the splat Points geometry each `preRender`.
- Main scene: `scene.background` warm cream; one large plane whose
  ShaderMaterial samples the feedback texture and maps density → ramp:
  paper (transparent) → warm sepia edge → dense near-black core, plus subtle
  procedural paper grain in the SAME shader (no extra pass). Composite over
  opaque paper in-shader — do not rely on transparent blending over
  scene.background (premultiplied-alpha fringe risk).
- Ink blooms on the RIGHT ~55%; LEFT stays clean paper (headline zone).
  Slow emission cycle: tendrils bloom, drift, decay; new drops seed
  periodically (deterministic schedule from the RNG).
- **Pre-warm:** on create, run ~90 synchronous steps at fixed dt=1/45 so the
  first visible frame is a developed bloom. Measure it (console.time in dev is
  fine, remove after): must stay well under one frame budget territory
  (~10ms) on this machine; if over, lower resolution scale, not step count.
  Set `thumbnailWarmup` LOW (~0.5s) — the create-time pre-warm already
  develops the bloom; document that interplay in the header comment.
- Reduced-motion: the create-time pre-warm IS the still frame — verify it
  looks composed.

## Variants (3)

- `sumi` — black ink on cream (default; art target)
- `indigo` — deep blue ink, slightly cooler paper
- `vermilion` — red-orange seal-ink, warmer paper

## Props (5)

- `flow` — advection/bloom speed (live)
- `density` — splat intensity per particle (live, uniform)
- `decay` — dissipation rate (live, uniform; range keeps ink from saturating
  to a black blob — verify at both extremes)
- `drops` — number of simultaneous bloom sites (rebuild)
- `grain` — paper grain strength (live, uniform)

## Verify + commit

- `npx tsc --noEmit` && `npm run build` clean; all existing 14 recipes render
  (contract change touches everything — check several thumbnails + one live
  recipe beyond your own); Inkfall thumbnail shows a developed LIGHT bloom;
  variants distinct; props respond incl. decay extremes; texture-memory
  baseline restored after dispose; state invariant holds (render a different
  recipe immediately after Inkfall in the thumbnailer and confirm it's clean).
- Commit (do NOT push): `feat(landing): Inkfall feedback-buffer hero recipe`
  — include the engine changes in the same commit (they ship together).
- Write `TASKS/inkfall-report.md`.

Work autonomously start to finish; do not wait for confirmation between steps.
