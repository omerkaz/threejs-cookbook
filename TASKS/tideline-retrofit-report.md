# Tideline quality retrofit — report

Calibration target: ThreeUI `tidecrest-hero.html` (60 KB, studied from
`/tmp/tidecrest-hero.html`, not committed). Rules followed from
`TASKS/reference-board.md`: craft vocabulary lifted, identity kept ours —
Tideline is still a revenue chart rendered as an ocean, still teal on navy,
still with a calm left third reserved for a headline.

## Outcome

Tideline now renders through its own EffectComposer with half-resolution
bloom and an ACES output stage, every shader writes linear HDR, one air-tone
uniform ties depth and distance together, foam density is a screen-space
constant, and point sizes are scaled to a 720px reference frame. Two engine
extensions made that possible without any other recipe changing by a single
byte.

The retrofit also turned up **a bug that had been hiding in Tideline since it
shipped: the water body had never drawn a pixel** (details below).

## Part A — engine extensions

### 1. `RecipeMeta.rendering?: { toneMapping?: "aces"; exposure?: number }`

- `src/engine/types.ts` — new `RecipeRendering` type on `RecipeMeta`.
- `src/engine/harness.ts` — new exported `applyRendering(renderer, rendering)`.
  Returns immediately when `rendering` is undefined, which is what makes the
  change a no-op for every existing recipe. Exposure is clamped to
  `[0.05, 8]` so a typo cannot blank a scene. The harness owns one renderer
  per mounted recipe, so it applies this once at mount.
- `src/engine/thumbs.ts` — applies it *after* `resetRendererState()` and
  relies on the next capture's reset to clear it, exactly as briefed.

### 2. `SceneBuild.render?(): void`

Optional full-render override. When present, the harness calls it instead of
`renderer.render(scene, camera)`, and the thumbnailer likewise at capture
time. The documented call order is `update` → `preRender?` → `render?`. The
contract puts sizing and disposal on the recipe: read
`renderer.getDrawingBufferSize()` (never the CSS box) and dispose composer
targets and passes in `dispose()`.

### Isolation proof

A non-Tideline thumbnail must be byte-identical before and after. Method:
headless Chrome renders thumbnails through the real `thumbs.ts` queue on the
shared renderer, and the PNG data URL is SHA-256'd.

| Recipe | Engine unmodified (`git stash`) | After Part A | After the full retrofit, rendered *after* Tideline |
|---|---|---|---|
| basilica | `7202abf074ea9093` | `7202abf074ea9093` | `7202abf074ea9093` |
| emberworks | `00e847a66e4279a2` | `00e847a66e4279a2` | `00e847a66e4279a2` |
| inkfall | `9c7e38de4f69e009` | `9c7e38de4f69e009` | `9c7e38de4f69e009` |

Identical in all three columns, and the hashes repeat exactly across runs, so
the comparison is meaningful rather than coincidentally stable. The third
column is the real test: Tideline sets ACES, changes exposure, and runs a
composer on the shared renderer immediately before those captures.

## Part B — the five lifted techniques

All tuned constants live in one commented `LOOK` object at the top of the
recipe, each with a one-line why.

1. **Half-res bloom.** `RenderPass → UnrealBloomPass → OutputPass`. Bloom is
   sized at `drawingBufferSize * 0.5` (clamped to ≥1px), re-stated after every
   `composer.setSize` because `setSize` resizes all passes and would silently
   return bloom to full resolution. Strength `0.58`, radius `0.42`, threshold
   `0.72` — only HDR highlights qualify, so the grid never haloes.
2. **ACES + HDR values.** `rendering: { toneMapping: "aces", exposure: 1.2 }`.
   The chain order matters and is the reason this works properly: three skips
   tone mapping when rendering into a render target, so the shaders' HDR
   values reach the bloom pass intact and are compressed once, at the end, by
   `OutputPass`. The composer target is `HalfFloatType` for the same reason.
   Crest core runs at `[1.95, 2.55, 2.40]` and foam sparkle peaks at
   `2.35 × (1 + 1.35 × sparkle)` — past 1.0 on purpose. Water, grid and halo
   were rebalanced down under the new curve.
3. **Air colour (`uHaze`).** One linear air tone `[0.011, 0.052, 0.094]`.
   A shared `AIR_GLSL` chunk gives every layer `airWash(col, vT)`: a lerp
   toward the air by `(1 - vT)` plus the air's own additive glow, with a
   per-layer wash and air-in amount. Grid rows now dissolve *into navy*
   instead of fading to grey on black. A new air backdrop layer carries the
   crest height per column as an attribute, so the sky glow hugs the rising
   tideline rather than sitting in a flat horizontal band.
4. **Screen-uniform foam density.** One particle per ~240 canvas pixels,
   derived from the drawing buffer and rebuilt when the viewport crosses a
   size bucket. Measured across viewports:

   | Viewport | Particles | px² per particle |
   |---|---|---|
   | 420×260 | 614 | 178 |
   | 900×560 | 2458 | 205 |
   | 1280×720 | 4369 | 211 |
   | 1920×1080 | 8260 | 251 |
   | 3200×1800 | 9000 (capped) | 640 |
   | 1×1 | 420 (floor) | — |

   Density holds to ±20% of nominal from a phone to a 1080p desktop. Above
   that the `foamMax: 9000` ceiling deliberately takes over rather than let a
   5K display allocate its way to a stall.
5. **Reference-frame sizing.** `uPixK = drawingBufferHeight / 720`, floored at
   `0.55` so a 300px-tall thumbnail keeps sub-pixel detail. Point sizes
   multiply by it directly. The crest core width *divides* by it — a
   world-space width holds a constant share of the frame, but a 2px line
   should be a 2px line everywhere, so the core is pixel-locked while the halo
   stays world-space (`pixLock` per ribbon).

Plus, from the cross-library patterns:

- **`pow(random, 2.2)` foam sizes** — few large motes carry the sparkle, the
  rest is spray.
- **Mirrored crest glints** — the crest ribbon program does double duty: a
  `uMirror` uniform remaps the strip to hang below the curve with an
  exponential fade and a noise-driven chop, so the reflection costs one draw
  call and no second pass.

## Iteration log (the quality loop)

Each round: screenshot our scene and the reference at 1440×900 (reference
served from a local `python3 -m http.server`), compare, write down gaps, fix.

**Iteration 1** — first composed build vs reference.
- G1 Crest core was a fat opaque white rope; the reference keeps every
  highlight thin and lets the halo do the glowing. → core width 0.03→0.016,
  softness 5.5→9.5, HDR peak 3.5→2.55.
- G2 Foam read as soft snowballs (~9px blobs) against the reference's tight,
  hard-edged, far denser dots. → sprite gradient tightened, `pointPx` 46→26,
  density 760→320 px²/particle.
- G3 Everything above the tide was flat black, while the reference's "empty"
  sky still glows navy. → added the air backdrop layer.

**Iteration 2** — air now present, crest is a filament.
- G4 The air flooded the frame: headline quiet zone gone, contrast crushed,
  and crest peaks threw broad vertical shafts. → floor 0.28→0.10, glow
  2.6→1.15, rise 1.35→0.70, lateral weighting hardened to 0.22+0.78.
- G5 The water's teal depth gradient was drowned. → water tones lifted.
- G6 Foam still countable. → density 320→240 px²/particle.

**Iteration 3** — composition and quiet zone correct.
- G7 The ocean under the tideline was still nearly empty black, where the
  reference fills its lower half with depth. Two fixes applied (longer
  falloff tail, higher alpha, lifted deep tone) **changed almost nothing** —
  which is what triggered the instrumented investigation below.
- G8 Mirrored glint invisible under the halo. → gain 0.30→0.42, drop
  0.62→0.85.

**Iteration 4** — after the water bug was fixed, the curtain finally drew and
immediately dominated.
- G9 The ocean swamped crest, foam and grid. → alpha 1.05→0.42, deep floor
  0.17→0.10, air wash 0.72→0.86.
- G10 Filaments were coarse ~20px bands, not fine striation. → streak
  frequency 210→420, contrast reduced.
- G11 Water hit the bottom edge at full strength. → explicit floor fade.

**Iteration 5** — final polish.
- The curtain's bright top edge was growing a second tideline that competed
  with the crest → `waterShallow` held below the core's brightness.
- The mass read cyan where the reference reserves cyan for highlights → air
  wash 0.82→0.86, halo gain 0.30→0.34.

## Two bugs found on the way

### 1. The water body had never rendered

Iteration 3's fixes doing nothing was the tell. Rather than keep guessing, I
instrumented: render each layer solo on an off-screen renderer, read back
pixels with `gl.readPixels`, and dump per-layer PNGs. The water layer was
submitting **11,484 triangles and writing zero pixels** — and still wrote zero
with the fragment shader replaced by flat opaque red, which ruled out shading
entirely.

Cause: the water mesh's index winding is clockwise in screen space, so with
the default `side: FrontSide` every triangle was back-face culled. This is
**pre-existing**, inherited from the original recipe — the "water curtain"
visible in earlier Tideline captures was the crest halo ribbon all along.

Fixed by correcting the winding (`index.push(a, a+1, b, b, a+1, b+1)`) rather
than masking it with `DoubleSide`, so back-face culling keeps doing its job.
The knock-on effect was large: the layer had to be re-tuned from scratch, which
is what iterations 4 and 5 are.

### 2. MSAA on the composer target produced completely black frames

Rendering into a target loses the canvas' own antialias, so the composer
target was created with `samples: 4`. Tideline's thumbnail then came back
**fully transparent** — a 3,970-byte PNG of nothing.

Measured across a size sweep, deterministic across runs (same pixel, centre
of frame):

| Drawing buffer | samples 0 | samples 2 | samples 4 | samples 8 |
|---|---|---|---|---|
| 480×300 | ok | ok | **0,0,0,0** | **0,0,0,0** |
| 600×375 | ok | ok | ok | ok |
| 720×450 | ok | ok | **0,0,0,0** | **0,0,0,0** |
| 840×525 | ok | ok | ok | ok |
| 960×600 | ok | ok | ok | ok |

Not a size threshold and not flaky, and a plain scene with the identical
composer configuration renders fine at 480×300 — so it is an interaction
between this recipe's content and >2-sample multisampled half-float targets
in this driver (headless Chrome / ANGLE). A capability query would not catch
it, since 4 samples are nominally supported.

Shipped with `msaa: 0`. Two samples passed the whole sweep, but a value that
merely *happened* to pass is not worth the risk of a blank hero, and the
crest is a soft alpha-falloff ribbon whose remaining aliasing the bloom blur
covers. The knob is kept with the evidence recorded in its comment, in the
reference's own "tried → measured → kept or zeroed" style.

## Verification

- `npx tsc --noEmit` — clean.
- `npm run build` — clean (`✓ built in 912ms`).
- **Isolation** — table above; three non-Tideline thumbnails byte-identical.
- **Variants** — all three distinct and captured: Rising, Volatile (sharper,
  denser, faster) and Calm (shallower, sparser, slower).
- **Props** — all five verified through `applyProps` on a live build; each
  returns `true` (no rebuild) and each measurably changes the framebuffer:
  swell, foam, glow, speed, gridOpacity.
- **Reduced motion** — the still frame shows the fully developed composed
  scene with bloom applied, at 0 FPS.
- **Thumbnails** — all three variants render the composed frame with bloom at
  480×300.
- **Resize** — density table above; `1×1` clamps to the floor without error.
- **Disposal** — 12 create/render/dispose cycles on one renderer leave
  `renderer.info.memory.geometries` unchanged at 7 (composer targets, all
  passes, and the foam sprite are disposed explicitly).

Verification ran in headless Chrome via Playwright, installed with
`npm i --no-save` so `package.json` is untouched. Scripts and captures live in
`/tmp/tl/` and are not committed.

## Known gaps

- **Density ceiling.** Above ~2.4 megapixels the `foamMax` cap takes over and
  density stops being screen-uniform. Deliberate, but it is a departure from
  the technique as the reference states it.
- **No antialiasing on the composed frame.** See bug 2. Worth revisiting with
  an FXAA pass after `OutputPass`, which would sidestep multisampled targets
  entirely.
- **Rebuild pacing is bucket quantization plus a 240ms floor**, not a true
  debounce timer. It needs no cleanup and is deterministic per bucket (which
  the brief requires for reproducible thumbnails), but a resize that settles
  inside the interval waits for the next frame after it.
- **Not attempted from the reference:** the occluder solid (our scene is a 2D
  function graph with no hidden-line problem), aspect-adaptive camera pitch
  (our camera is a fitted dolly, not a pitched orbit), and the in-page design
  panel.
