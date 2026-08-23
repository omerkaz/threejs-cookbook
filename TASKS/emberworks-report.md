# Emberworks — build report

Fourth landing-page hero recipe: a molten metal pour in a dark forge, sold as
"we build in metal" for dev-tools and CI/CD brands.
`src/recipes/scenes/emberworks.ts` (~700 lines, cookbook header included),
registered in `src/recipes/index.ts` directly after Basilica. Zero assets, zero
textures, no shadow maps, no postprocessing.

The multi-model verdict was **stylize-first**, and that is what was built: the
art target's photorealism was never the bar. The mood is carried by an
emissive ribbon, a ballistic spark spray and a breath of warm smoke on
near-black. No attempt was made at photoreal metal.

## How it is built

1. **The pour.** Three camera-facing ribbon passes swept along one authored
   spine — a wide dim halo, a mid body, and a narrow white-hot core. Each
   ribbon's `position` attribute *is* the spine; the vertex shader pushes each
   edge sideways along `cross(tangent, toCamera)` in view space. A ribbon has
   no volume, so it can never leave an intersection seam against the anvils,
   and it presents its full width from any camera.
2. **The impact pool.** An additive radial-gradient quad with a slow
   two-frequency pulse, a stretched runoff copy spreading along the anvil top,
   and a very wide, very dim halo standing in for bloom.
3. **Sparks.** 1.2k additive quad billboards (variant-scaled, capped at 2000).
   Each is a closed-form ballistic — `p = origin + v·t + ½g·t²` — evaluated in
   the vertex shader from a wrapped lifetime, and stretched along its own
   screen-space velocity so it reads as a motion streak. Brightness is a
   radial `exp(-r²)` in quad space with fade-in/fade-out on the lifetime, so
   nothing ever pops. The leading end of each streak sits higher on the
   temperature ramp than the tail.
4. **Smoke.** 9 large, very-low-alpha billboards drifting up through the heat,
   expanding and slowly rotating as they rise.
5. **Silhouettes.** A tipped open cylinder as the crucible wedge at the
   top-right and four dark anvil blocks along the bottom, lit *only* by the
   pour: a single dim orange `PointLight` at the pool fakes the bounce. There
   is no ambient, no fill, no key — one light in the whole scene.

Colour everywhere comes from one shared GLSL `emberRamp(t)`: a two-mix
blackbody-style scale from the variant's edge colour through its mid to its
core (`#d84315 → #ff9a3c → #fff6e0` for `steel`).

## The hard constraints, and how they are met

**No screen-space heat haze — and no postprocessing at all.** There is no
`EffectComposer`, no `WebGLRenderTarget`, and nothing is read back. The only
shimmer in the recipe happens in two places that cost nothing extra: a
noise-driven displacement of the pour's spine in the **vertex** shader
(`spineWobble`), and UV-space flow noise ("molten skin") inside the pour's own
**fragment** shader.

**Pour deformation strategy (a), documented in the header.** `TubeGeometry` is
static and was rejected on purpose — animating a pour by rebuilding a tube
would throw away a vertex buffer every frame. Instead the spine is sampled
once on the CPU (97 samples, tangents by central difference) and displaced in
the vertex shader by three 1D value-noise samples. All three ribbon passes call
the same `spineWobble()` with the same `uTurb`/`uTime`/`uFlow` uniforms, so the
halo and the core writhe as one body and can never drift apart. Nothing is
re-tessellated per frame.

**Transparency ordering is authored, not sorted.** Every glowing element is
additive with `depthWrite: false`, so `renderOrder` is explicit and commented:

| Layer | renderOrder | Blending | depthWrite |
|---|---|---|---|
| Crucible + anvil blocks | 0 (opaque) | normal | yes |
| Smoke | 5 | additive | no |
| Impact bloom halo | 7 | additive | no |
| Pool + runoff | 8 | additive | no |
| Ribbon halo + body | 10 | additive | no |
| Ribbon core | 12 | additive | no |
| Sparks | 20 | additive | no |

Back to front, cool to hot. The opaque silhouettes are additionally authored
*behind* the `z ≈ 0.2` plane the pool and runoff live on, so no anvil front
face can occlude the splash — an early version had the blocks at `z = 0.2`
with 2.2 of depth, and the pool was visibly sliced by a block's front face.

**Deterministic hero pose.** Every motion in the scene is a closed-form
function of one accumulated clock: the ribbon reads `uTime`, the pool pulse
reads `uTime`, and both particle systems derive a wrapped lifetime from
`fract(seed + uTime * … )` and evaluate position analytically. Nothing is
integrated on the CPU, so the thumbnailer's single `update(warmup, warmup)`
call composes exactly what that many seconds of frames would.
`thumbnailWarmup: 6` was chosen because shorter warm-ups catch the spray still
bunched at the emitter. All scatter runs through
`createRng(hashSeed("emberworks:<variant>"))`.

**Headline quiet zone.** Every emissive element is authored right of centre,
and the two systems that can travel (sparks, smoke) multiply their alpha by a
world-space gate `smoothstep(-2.05, -0.65, x)` in the vertex shader, so an
ember physically cannot reach the headline. Spark launch angles are also biased
up and to the right. Measured below.

Camera fit is a **contain** fit, like Basilica: a hero must not crop its own
subject, so narrow viewports pull the camera back instead of losing the pour.

## Fixes found during visual verification

- **The pool was sliced by an anvil.** The blocks sat at `z = 0.2` with 2.2 of
  depth, so their front faces (at `z = 1.3`) occluded the additive pool and
  runoff at `z ≈ 0.2`. The splash was cut off along a hard horizontal line.
  All blocks moved behind `z = 0`.
- **The stream read as a thin neon wire.** The first half-width profile peaked
  at 0.39 world units and the core pass was scaled to 0.85 of that. Widened the
  profile (0.46 base) and the passes (halo 3.6×, body 1.9×, core 1.15×), and
  dropped the wobble frequency from 5.5 to 3.2 so the writhe is lazy rather
  than buzzy.
- **Floating anvil ends in portrait.** The contain fit pulls the camera back on
  narrow viewports, which exposed the outer ends of the left and right blocks
  as detached bars. Those two blocks are now 6 units wide and run past the
  widest possible fit.
- **The runoff read as a lens-flare bar.** Shortened from 6.4 to 5 units and
  dimmed from 0.5 to 0.42 gain.

## Verification

- `npx tsc --noEmit` — clean. `npm run build` — clean apart from the
  pre-existing "chunks larger than 500 kB" advisory about the `three` bundle.
- Verified in Chrome against the production build (`npm run preview`).
- **The thumbnail is a composed frame**, not an empty pre-warm one: the
  Emberworks card on the browse grid shows the full pour, the lit pool and a
  spark spray spread across its whole lifetime range.
- **The browse grid reports 14 recipes** and 14 cards. 13 of the 14 thumbnails
  rendered; the missing one is Pendulum Wave, which is *last* in the registry
  queue. The thumbnail queue drains one job per `requestAnimationFrame`, and an
  in-page probe confirmed this automated tab never fires `rAF` at all (it is
  never painted) — the same measurement artifact the Tideline, Paper Relief and
  Basilica reports describe. The twelve pre-existing thumbnails ahead of it in
  the queue all render, so the new recipe causes no engine regression.
- **All three variants are distinct** and were captured: `steel` (white-hot
  core, orange body, deep red edge — the art target), `gold` (amber/gold ramp,
  visibly thicker and slower stream, richer halo), `plasma` (blue-white
  electric ramp over near-black blue edges, faster and denser sparks).
- **The left third stays dark in every variant.** Mean luminance of the left
  third of the canvas, out of 255:

  | Variant | Left third | Middle third | Right third |
  |---|---|---|---|
  | steel | 4.7 (max 11) | 38.5 | 23.0 |
  | gold | 5.2 (max 11) | 46.2 | 30.2 |
  | plasma | 5.2 (max 11) | 27.9 | 17.6 |

  For scale, the same measurement with `heat = 0` (nothing emissive rendering
  at all) gives a left third of 5.15 — the quiet zone is at the background
  floor, and no pixel in it exceeds 11/255 in any variant.
- **All five props respond**, measured as the mean absolute luminance change
  over the canvas between two captures. The scene animates continuously, so the
  meaningful baseline is the **noise floor of 3.22** measured between two
  captures of the unchanged default state:

  | Prop | Change | Mean abs diff | Pixels changed > 12 |
  |---|---|---|---|
  | heat | 1 → 0 | 17.00 | 19.8% |
  | heat | 1 → 2 | 8.25 | 16.4% |
  | turbulence | 1 → 2.5 | 5.38 | 9.1% |
  | smoke | 1 → 0 | 5.09 | 9.3% |
  | smoke | 1 → 2 | 5.19 | 9.1% |
  | sparks | 1 → 2 (rebuild) | 4.65 | 8.9% |
  | pour | 1 → 0 / 1 → 2.5 | 3.76 / 3.57 | ≈ floor |

  `heat = 0` blanks every emissive layer and the point light (whole canvas
  drops to a mean of ~5). `sparks = 0` removes the spray entirely, confirmed
  visually — its numeric delta is modest only because sparks are small and
  sparse. `pour` changes animation *speed*, which a still-frame diff cannot
  see, so it was measured in the time domain instead: with sparks and smoke
  turned off to isolate the ribbon, two captures five seconds apart differ by a
  mean of **0.24 with no pixel changing more than 12/255 at `pour = 0`** (the
  stream is frozen) versus **2.82 / 4.4% at `pour = 2.5`**.
- **Aspect ratios:** at 340×620 (portrait, aspect 0.55) the contain fit pulls
  the camera back; the whole pour is visible from the crucible lip to the pool,
  the anvils run off both edges, and the left side stays black.
- **Rebuild path:** cycling Steel → Gold → Plasma → Steel → Gold → Steel leaves
  the canvas alive and the props at their defaults, with no console errors.

**Unverified:** the on-page FPS readout. The automated Chrome tab is never
painted — an in-page `requestAnimationFrame` probe recorded zero frames — so
the counter reads 0 regardless of scene cost. The frame budget is small by
construction: 5 opaque meshes against one standard material with one point
light, 3 ribbon meshes of 194 vertices each, 3 gradient quads, 9 smoke quads
and ≤2000 spark quads, with no render targets and no postprocessing. A
foreground FPS check still needs a human at the browser.
