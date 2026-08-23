# Inkfall — build report

Fifth landing-page hero recipe, and the cookbook's first render-target
feature. Two pieces ship together: a `preRender` contract plus a
`FeedbackBuffer` ping-pong system in the engine (Part A), and the Inkfall
recipe built on top of it (Part B).

Files: `src/engine/feedback.ts` (new, 443 lines),
`src/recipes/scenes/inkfall.ts` (new, ~560 lines), contract changes in
`src/engine/types.ts` / `harness.ts` / `thumbs.ts`, copy-source whitelist in
`src/app/prompt.ts`, registry entry after Emberworks, README updates.

The verdict was **stylize-first**, and that is what was built: no fluid
solver, no Navier–Stokes, no pressure projection. Curl noise moves particles,
a decaying feedback field turns their trails into ink, and one shader decides
what ink looks like.

---

## Part A — the engine feature

### The contract

- `SceneContext` gained `renderer: THREE.WebGLRenderer` (a required field —
  the harness, the thumbnailer and the Installation page snippet were all
  updated).
- `SceneBuild` gained optional `preRender(dt)`, called immediately before the
  main render by the harness and once per warm-up step by the thumbnailer.
- **State invariant.** `FeedbackBuffer.step()` saves and restores the previous
  render target and `autoClear` itself, *and* the harness runs a
  `restoreRendererState()` in a `finally` after every `preRender`, *and* the
  thumbnailer runs its existing `resetRendererState()` in a `finally` around
  warm-up plus capture. Three independent layers; a buggy recipe can only
  break its own frame.
- **Thumbnailer warm-up.** Closed-form recipes still get one big
  `update(warmup, warmup)` jump — that is exactly what their maths expects.
  Recipes with `preRender` integrate state instead, so a single huge dt would
  collapse (and be clamped) into one step; they get fixed 45 Hz steps
  (`round(warmup * 45)`, capped at 240) with `update` + `preRender` each.

### FeedbackBuffer

Two `WebGLRenderTarget`s take turns. Per step: decay/advect pass (samples the
previous target with an upward, noise-warped offset, applies a 5-tap diffusion
and a fade), then the splat pass (the owner's particles as ONE `THREE.Points`
draw call with a canvas radial-gradient sprite), then swap.

Constraints from the review, and how they are met:

| Constraint | Implementation |
|---|---|
| Half resolution, long edge ≤ 1024, no zero-size | `getDrawingBufferSize() × 0.5`, clamped, every dimension `Math.max(1, Math.floor(…))` |
| Half-float only when supported | WebGL2: `EXT_color_buffer_float` (or `…_half_float`); filtering is core on WebGL2, otherwise `OES_texture_half_float_linear`. WebGL1: `OES_texture_half_float` + the linear extension |
| 8-bit fallback must not band | `UnsignedByteType` + a screen-space hash dither of ±½ LSB added in the decay pass before the write |
| Density is data, not colour | `NoColorSpace` on both targets and on the splat sprite; every colour decision lives in the recipe's composite shader |
| One draw call for splats | a single `THREE.Points`; positions/sizes/strengths are plain `Float32Array`s the owner writes into, then `markSplatsDirty()` |
| dt clamp | `step()` clamps to `min(dt, 1/30)`, and `uFade = decay^(dt·60)` keeps dissipation frame-rate independent |
| Resize | `resize()` reallocates at the new drawing-buffer size, clears, and returns `false` when nothing changed so the owner can skip its re-warm |
| Context restore | `rebuild()` disposes and recreates both targets; the recipe listens for `webglcontextrestored` on `renderer.domElement` |
| Disposal | both targets, both pass materials, quad + splat geometry, splat texture |

Two things were added beyond the brief after measurement:

- **Both passes render from one scene** (opaque decay quad at `renderOrder 0`,
  additive points at `1`) instead of two `render()` calls. This was an
  optimisation attempt; it turned out to be worth ~0 ms, but it is simpler, so
  it stayed.
- **The diffusion tap is fixed in UV, not in texels.** With a one-texel tap, a
  retina drawing buffer blurs a *smaller fraction* of the field per step, and
  the identical scene reads visibly thinner on a high-DPI screen than in a
  480×300 buffer. The tap is now `max(1, shortEdge/384)` texels, isotropic in
  pixels. Splat radii are likewise authored against the buffer's **short**
  edge, which is what keeps a portrait viewport from getting splats that are
  huge relative to its width.

### Copy-source whitelist

`buildCode()` no longer special-cases noise. It walks an explicit, ordered
whitelist — `engine/rng`, `engine/noise`, `engine/feedback` — appending each
at most once and only when the recipe's source imports it. No import
traversal: these three modules are small and hand-audited, and a traversal
would happily drag the whole engine (or a cycle) into somebody's clipboard.
Verified against all 15 recipes (table below).

---

## Part B — the recipe

- **1500 CPU particles** (brief range 1.5–2k) advected by curl noise derived
  from `fbm2`: the stream function is fBm, the velocity is its curl, so the
  flow is divergence-free and reads as liquid rather than wind. Forward
  differences (3 samples, 2 octaves) instead of central (4 samples): at this
  frequency the asymmetry is invisible and it is measurably cheaper.
- **Emission**: 4 sites (the `drops` prop) in the right-hand third, at or just
  below the bottom edge, each with its own phase and rate. A site's envelope
  pumps for the first ~third of its cycle and rests for the rest while the ink
  it laid down dissipates, and its mouth rises across the cycle — so blooms
  appear, drift, decay, and new ones seed, on a schedule that is entirely
  deterministic (`hashSeed("inkfall:<variant>")`).
- **Per-respawn randomness is hashed, not drawn from the RNG stream.**
  Particles respawn thousands of times; pulling from the build-time stream
  would make the state depend on how many frames had been rendered, so the
  live view and the thumbnail would diverge. `hash01(index, respawnCount,
  salt)` is stateless and reproducible.
- **Composite**: one opaque full-viewport quad. Density → `smoothstep` wash →
  `smoothstep` body, mapping paper → warm sepia edge → near-black core, with
  paper mottle, fibre and tooth in the same shader (no extra pass). Opaque on
  purpose: blending ink over `scene.background` would put a premultiplied-alpha
  fringe around every tendril. The paper tooth also multiplies into the ink,
  which is what gives thin strokes their dry, broken sumi edge.
- **Headline zone**: emission is right-of-centre, particles get a soft
  velocity wall at x = 0.5, and the composite gates density with
  `smoothstep(0.36, 0.5, uv.x)` — a stray tendril cannot reach the headline
  even if the flow field pushes one there.
- **Pre-warm**: 90 steps at a fixed dt = 1/45 inside `create()`, so the first
  visible frame — live, thumbnail, or reduced-motion still — is a developed
  bloom. `thumbnailWarmup` is therefore a low **0.5 s** (~23 further steps):
  the thumbnailer only nudges the bloom rather than growing it. That
  interplay is documented in the recipe's header comment.
- **Resize** is polled from `preRender` against the drawing-buffer size and
  debounced 150 ms, so dragging a window edge reallocates and re-warms once
  (45 steps), not sixty times. **Context restore** rebuilds the targets and
  re-warms with the full 90 steps, because that frame is user-visible.

### Variants

| Variant | Ink | Paper | Character |
|---|---|---|---|
| `sumi` | near-black `#14120f` over sepia edge | cream `#ece5d8` | the art target |
| `indigo` | `#121a2c` over slate blue | cool grey-white | calmer, wider curl scale |
| `vermilion` | `#51160e` over burnt orange | warm sand | faster, finer, more agitated |

---

## Pre-warm cost — measured, and where the brief's assumption did not hold

Measured on this machine (M2, ANGLE Metal, Chrome), timing `create()` alone:

| Configuration | ms |
|---|---|
| First ever call (includes shader compile) | ~50 |
| Steady state, final build | **13–17** |
| Same, with the GPU passes skipped (CPU advection only) | ~10.8 |
| Same, with half the particles | ~12.5 |
| Same, at `resolutionScale` 0.35 instead of 0.5 | unchanged |

So the cost splits roughly into ~6 ms of CPU advection and ~8 ms of
per-call overhead for the 90 ping-pong passes. **Lowering the resolution scale
does not help**, because the cost is per-call overhead, not fill rate — the
brief's suggested lever is the wrong one here, and the measurement above is
the evidence. What did help: 2-octave curl instead of 3, a curl stride of 6
(the field is smooth, so re-sampling every 6th step per particle is
invisible), and 1500 particles rather than 1700 — together 20 ms → 14 ms.

The remaining ~14 ms is a one-time hitch at mount, not a per-frame cost;
steady-state frames run one 1500-point splat pass, one full-screen decay pass
and one full-screen composite. It is above the ~10 ms the brief hoped for, and
that is stated rather than hidden.

---

## Verification

Because an automated Chrome tab is never painted (`requestAnimationFrame`
never fires — the same artifact every prior report describes), verification
ran through a temporary probe page that drove recipes **synchronously** on a
`preserveDrawingBuffer` canvas and read pixels back. The probe was deleted
before the commit; every number below came from it.

- **`npx tsc --noEmit` and `npm run build` are clean**, apart from the
  pre-existing "chunks larger than 500 kB" advisory about the `three` bundle.
- **All 15 recipes render after the contract change.** Every recipe was
  created, stepped and captured; all produced non-degenerate frames (mean
  luminance 11–185, no blanks, no throws).
- **All 15 thumbnails render through the real thumbnail service**, driven with
  `requestAnimationFrame` patched to run inline so the queue drains. Inkfall's
  is a developed *light* bloom: paper with tendrils, not an empty pre-warm
  frame.
- **State invariant holds.** Basilica rendered immediately after Inkfall on
  the shared thumbnail renderer is **pixel-identical** (mean abs difference
  0.00, 0 pixels changed) to Basilica rendered standalone. The Polyhedra Lab
  thumbnail that the real service renders directly after Inkfall's is clean
  dark-background geometry with no ink bleed.
- **Texture memory returns to baseline.** `renderer.info.memory.textures` is 0
  before, 3 during Inkfall (two targets + splat sprite), and **0 again after
  dispose** — including after a resize and after a context rebuild.
- **Variants are distinct** against a noise floor of exactly 0 (the recipe is
  deterministic, so two identical runs differ by nothing):

  | Change | Mean abs luma diff | Pixels changed > 12 |
  |---|---|---|
  | variant → indigo | 13.84 | 20.5% |
  | variant → vermilion | 16.36 | 21.7% |

- **All five props respond**, both when set at build time and when applied
  live mid-run through `applyProps` (the live figures below are a 1 s run,
  prop change, then 2 s more):

  | Prop | Live mean abs diff | Pixels changed > 12 |
  |---|---|---|
  | flow 1 → 0 | 14.39 | 27.2% |
  | flow 1 → 2.5 | 8.31 | 20.1% |
  | density 1 → 2.5 | 19.03 | 35.9% |
  | decay 0.22 → 1 | 14.17 | 27.0% |
  | decay 0.22 → 0 | 6.70 | 21.8% |
  | grain 0.7 → 0 | 10.73 | 40.4% |
  | drops 4 → 1 / 4 → 6 (rebuild) | 15.83 / 9.24 | 20.6% / 15.9% |

- **Decay extremes were tuned against measurement, not taste alone.** The
  first mapping (0.9985 → 0.9855 per-frame survival) silted up: at `decay = 0`
  after 25 s the right third fell to a mean of **98.9/255** — a flat black
  mass, exactly the failure the brief names. The final mapping is
  `0.9965 − 0.0075 · decay` (half-lives ~3.3 s to ~1.0 s), and the same run
  now measures **133.5**, with paper visible between veined columns. At the
  other extreme the field clears to near paper (right third 178–185 depending
  on where the emission cycle is caught) — the hero becomes faint wisps
  between blooms, which is what "maximum dissipation" should look like.
- **The headline zone stays clean paper in every variant** (12 s runs, mean
  luminance per third out of 255):

  | Variant | Left third | Middle | Right | Left min | Left max |
  |---|---|---|---|---|---|
  | sumi | 190.3 | 162.1 | 129.1 | 171.4 | 208.4 |
  | indigo | 191.8 | 167.0 | 137.6 | 173.8 | 209.2 |
  | vermilion | 194.1 | 178.4 | 156.5 | 173.4 | 214.0 |

  The left third's minimum (171) is the paper's own shaded grain value; ink
  cores measure 14–33. No ink pixel exists left of the gate in any variant.
- **The 8-bit fallback was exercised**, not just written: forcing
  `UnsignedByteType` produced a frame within **0.2 luma** of the half-float
  frame (mean 169.2 vs 169.0, min 32.1 vs 32.0) with no banding, and a 20 s
  run at maximum decay and minimum density returned the right third to 188.1
  against paper at 190.3 — the dither keeps the dissipation tail fading
  instead of freezing. On this machine the half-float path is the live one
  (WebGL2 + `EXT_color_buffer_float`; `OES_texture_half_float_linear` is
  absent, as expected, since RGBA16F filtering is core in WebGL2).
- **Resize and context restore.** Resizing the renderer to 620×420 mid-run
  triggers the debounce, reallocates and re-warms; the frame afterwards still
  contains ink (min luma 79, i.e. a young bloom) and texture count stays at 3.
  A `webglcontextrestored` event rebuilds and re-warms fully (min luma 33 — a
  developed bloom). *Caveat:* the event is synthetic, dispatched on a context
  that was never actually lost, which makes three's own renderer re-init emit
  a transient `INVALID_OPERATION` — reproduced identically with Tideline,
  which has no listener at all, so it is an artifact of the test, not of this
  recipe.
- **Aspect ratios.** Portrait (420×760) reads as tall vertical ink strokes
  with the left half clean; ultra-wide (1400×420) reads as a low, spreading
  wash; retina-scale (1690×880) is the best-looking of the three — fine
  filaments over dense cores. The short-edge splat scaling and the fixed-UV
  diffusion tap were both added because the first portrait and retina captures
  looked wrong.
- **Copy-code whitelist** across all 15 recipes: `tideline` → rng;
  `paper-relief`, `basilica` → rng, noise; `emberworks` → rng;
  `wireframe-terrain` → noise; **`inkfall` → rng, noise, feedback (3 blocks,
  in dependency order)**; the remaining nine append nothing. Matches the
  actual import statements exactly.
- **The live app was checked** against the production build (`npm run
  preview`): the Inkfall page mounts, shows the pre-warmed bloom immediately,
  lists 3 variants and 5 props, and the sidebar reports 15 recipes.

**Unverified:** the on-page FPS readout, for the usual reason — the automated
tab is never painted, so the counter reads 0 no matter what the scene costs. A
foreground frame-rate check still needs a human at the browser. The per-frame
budget is small by construction (one 1500-point splat pass and two
full-screen passes at half resolution), but that is an argument, not a
measurement.

---

## Fixes found during visual verification

- **The first build was blobs, not ink.** Terminal velocity worked out to
  ~0.03 UV/s, so particles barely left their emitter and stamped a solid disc.
  Rebalanced buoyancy, drag and curl amplitude until particles cross ~0.4 of
  the frame within their life.
- **The second build was a starburst.** Every particle got a large random
  offset into the curl field, so neighbours flew in unrelated directions. The
  offset is now small (±0.06 UV) — enough to break lockstep, small enough that
  neighbours still share the same eddy — and per-particle *agility* (0.45–1.95)
  gives the streaking that reads as filaments.
- **The plume hung in mid-air.** Emitters moved to (and slightly below) the
  bottom edge so the ink is cropped by the frame and reads as continuing past
  it, like the art target.
- **Ink read thinner on retina than in the probe** — the fixed-UV diffusion
  tap described above.
- **Portrait looked coarse and heavy** — splat radii now scale with the
  buffer's short edge instead of its height.
