# Paper Relief — completion report

Paper Relief ships as the second recipe in the **Landing** category: a
light-mode cut-paper mountain diorama. `npx tsc --noEmit` and `npm run build`
are clean, and every claim below was checked in Chrome against the production
build (`npm run preview -- --port 4822`). Committed as
`feat(landing): Paper Relief cut-paper hero recipe` (f38d9e7), not pushed.

## What it is

`src/recipes/scenes/paper-relief.ts`, registered directly after Tideline in
`src/recipes/index.ts` (normal + `?raw` import). One file, no external assets,
no postprocessing, no lights, no textures, no shader materials — the entire
look is silhouette plus palette on `MeshBasicMaterial`.

| Piece | How it is built |
|---|---|
| Sky | One vertex-coloured `PlaneGeometry`, opaque, top→horizon ramp anchored to the authored composition and clamped beyond it. `scene.background` is set to the variant's horizon colour so the harness' near-black clear never shows. |
| Ridges | 8 layers. Each profile is sampled at strictly monotone-increasing x (fixed step + jitter bounded to a third of the step) and displaced in **y only** with `fbm2`; far layers fold the noise into ridged peaks (`1 - abs(2n-1)`), near layers roll. The profile is closed downward and triangulated by `ShapeGeometry`. A function graph closed by its own baseline cannot self-intersect, which is the whole guarantee. |
| Contact shadows | A gradient ribbon **parented to** each layer's top edge — vertex-alpha (colour attribute of itemSize 4, so three.js enables vertex alpha with no custom shader), `transparent`, `depthWrite: false`. Quads are emitted only where the layer *behind* actually rises above the front profile, and the ribbon height is clamped to that gap, so a shadow can never smudge into open sky. No shadow maps anywhere. |
| Paper furniture | Flat-bottomed scalloped clouds (tangent upper semicircle arcs over a base line — tangent, never overlapping, so the outline stays a simple polygon), V-shaped birds that flap by y-scale, and firs/bushes merged into one buffer each and parented to the nearest ridge. Night adds a paper moon (two offset discs) and 46 star discs. |
| Depth / parallax | Layers sit at real z and are scaled by `(camZ - z) / camZ`, so each covers exactly the screen area it would at z = 0. Drift is then added in *unscaled* world units, so the perspective divide produces genuine parallax: near layers sweep, far ridges barely move. |

Camera fit is Tideline's cover-dolly, so the composition — including the calm
upper-left headline zone — survives any aspect ratio. Contours run to x = ±16
and down to y = −9 so drift and extreme aspects never expose a paper edge.

All stochastic placement runs through `createRng(hashSeed("paper-relief:<variant>"))`.
`thumbnailWarmup: 4` gives the clouds and birds time to spread.

## Fixes found during visual verification

- **Clouds were upside down.** `Path.absarc(cx, cy, r, PI, 0, false)` sweeps
  counter-clockwise, which three.js resolves as PI → 2PI — the *lower*
  semicircle. `clockwise: true` takes the short way and gives the intended
  scalloped top over a flat bottom.
- **Warmth went magenta.** Rotating hue toward orange takes a blue ridge
  through purple. Temperature is now a tint blend toward a warm or cool paper
  colour, which is both more predictable and closer to how paper stock reads.
- **Birds read as white checkmarks.** They were cream and far too large;
  they are now small and tinted darker than the sky behind them.
- **Summits were cropped.** On ultra-wide viewports the cover fit trades
  vertical range for width, and the wide thumbnail cut the tallest ridge. The
  two back layers were lowered so summits stay under y ≈ 2.4.

## Verification

- `npx tsc --noEmit` — clean. `npm run build` — clean apart from the
  pre-existing "chunks larger than 500 kB" advisory about the `three` bundle.
- Browse page reports **12 recipes**; the sidebar shows Paper Relief under
  Landing with a 4-variant badge.
- **Thumbnail renders light**, not dark: a pastel sky, full mountain peaks,
  clouds and foreground trees. It is the only bright card in the grid.
- All 11 pre-existing recipes still generate their thumbnails — no engine
  regression from the new recipe (checked after a full-page scroll: every
  `<img>` in the grid reports `complete && naturalWidth > 0`).
- **All four variants are distinct and were captured:** `alpine` (blue-green
  pastels, white-blue sky), `coast` (teal water band over sand),
  `dune` (warm terracotta gradient), `night` (navy diorama with a paper moon
  and star dots).
- **All five props respond.** `warmth 1` + `haze 1` warms the palette to gold
  and washes the far ridges toward the horizon; `depth 2.4` widens the
  parallax spread; `drift 0` freezes the scene; `warmth -1` cools it to blue;
  `haze 0` restores full saturation; `ruggedness 1.8` triggers the clean
  rebuild path and produces markedly taller, sharper peaks with no error.

**Unverified:** the on-page FPS readout. The automated Chrome tab runs in the
background, where `requestAnimationFrame` is throttled to a couple of frames
per second, so the counter is meaningless there — the same measurement
artifact the Tideline report describes. The frame budget is small by
construction (about 20 opaque draw calls, roughly 4k triangles, seven small
transparent ribbons, zero fragment-heavy passes), but a foreground FPS check
still needs a human at the browser.
