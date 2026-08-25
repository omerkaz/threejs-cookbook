# Task: Tideline quality retrofit — calibrate against Tidecrest

## Goal

Raise **Tideline** (`src/recipes/scenes/tideline.ts`) from engineering-complete
to reference-grade by lifting five named techniques from ThreeUI's
`tidecrest-hero.html`. This is the pilot of our quality loop: the deliverable
is a visible before/after, not new features.

**Working rule** (from `TASKS/reference-board.md`): lift craft vocabulary
freely — tone curves, density shaping, GLSL patterns; transform identity —
our composition, palette, and chart-as-ocean story stay ours.

## Read first (in order)

1. `TASKS/reference-board.md` — the Tidecrest deep notes are your spec
2. `TASKS/reference-sylva-notes.md` — HDR-into-ACES philosophy
3. Download the reference for study (do NOT commit it):
   `curl -sL https://threeui.com/landing-pages/tidecrest-hero.html -o /tmp/tidecrest-hero.html`
   Read its scene code: grid builders, DOT materials, uHaze usage, bloom setup.
4. `src/engine/types.ts`, `harness.ts`, `thumbs.ts` — note the preRender
   contract and `SceneContext.renderer` added by the Inkfall work
5. `src/recipes/scenes/tideline.ts` — current state
6. `concepts/05-tideline.png` — our identity target (unchanged)

## Part A — engine extensions (small, surgical)

1. `RecipeMeta.rendering?: { toneMapping?: "aces"; exposure?: number }` —
   harness applies it to its renderer at mount; thumbnailer applies it per
   capture AFTER `resetRendererState()` and relies on the next capture's
   reset to clear it. **Isolation is critical: recipes without this field
   must render exactly as before — verify another recipe's thumbnail is
   byte-stable before/after your change.**
2. `SceneBuild.render?(): void` — optional full-render override. If present,
   harness calls it instead of `renderer.render(scene, camera)`; thumbnailer
   likewise at capture. Purpose: recipe-owned EffectComposer. The build must
   size/resize its composer from `renderer.getDrawingBufferSize()` and
   dispose composer render targets in `dispose()`.

## Part B — the five lifted techniques

1. **Half-res bloom**: EffectComposer (RenderPass + UnrealBloomPass from
   `three/examples/jsm/postprocessing/...`) with bloom sized at
   `drawingBufferSize * 0.5`. Restrained: strength tuned so the crest core
   and foam sparkle glow without haloing the grid. Composer resize on canvas
   resize.
2. **ACES + HDR values**: `rendering: { toneMapping: "aces", exposure: ~1.2 }`
   and push crest-core/foam emissive values PAST 1.0 (HDR into ACES, the
   Sylva rule). Rebalance water/grid colors under the new curve.
3. **Air color (`uHaze`)**: one uniform air tone (deep-navy teal); water,
   grid, crest, and foam all lerp toward it with depth/distance
   `(1.0 - vT)` style. Grid rows farther from camera wash into the air
   instead of just fading alpha.
4. **Screen-uniform foam density**: derive foam count from canvas pixel area
   (a particle every ~N px², N tuned), rebuilt on debounced resize — density
   reads constant at every viewport. Keep the seeded RNG deterministic per
   (variant, size bucket).
5. **Reference-frame sizing**: `uPixK = drawingBufferHeight / 720` uniform
   scaling point sizes and crest ribbon width — consistent visual weight on
   every device.

Plus, from the cross-library patterns: shape foam particle sizes with
`pow(random, ~2.2)` (few large, many small), and add **mirrored crest
glints** — a dim vertically-flipped copy of the crest ribbon fading into the
water body (geometry flip + fade, cheap).

**Knob culture:** collect every tuned constant into a named, commented
`LOOK` object at the top of the recipe (air tone, bloom strength, density
N, size distribution exponent, glint gain...) with a one-line why per knob.

## Quality loop (mandatory)

At least 3 critique iterations: screenshot our scene AND the reference
(serve `/tmp/tidecrest-hero.html` locally, e.g. `python3 -m http.server` in
/tmp, screenshot both), compare side by side, write down 2–3 concrete gaps,
fix, repeat. Record each iteration's gaps in the report. If browser tooling
is unavailable, say so explicitly and stop after static verification.

## Verify + commit

- `npx tsc --noEmit` && `npm run build` clean.
- **Isolation proof**: capture one non-Tideline thumbnail before and after —
  identical (tone-mapping leak check).
- All 3 Tideline variants still distinct; all 5 props still work; reduced
  motion/thumbnail shows the developed composed frame with bloom applied.
- Commit (do NOT push):
  `feat(landing): Tideline quality retrofit — atmosphere, HDR glow, screen-uniform density`
- Write `TASKS/tideline-retrofit-report.md` including the iteration log.

Work autonomously start to finish; do not wait for confirmation between steps.
