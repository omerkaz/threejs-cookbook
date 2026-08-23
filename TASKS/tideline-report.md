# Tideline — completion report

Tideline ships as the flagship recipe of a new **Landing** category, and the
three engine upgrades the multi-model review asked for landed first. `npx tsc
--noEmit` and `npm run build` are clean, and the scene was verified in Chrome
against the production build (`npm run preview -- --port 4821`).

## Part A — harness upgrades

| Change | File | Notes |
|---|---|---|
| Thumbnailer state isolation | `src/engine/thumbs.ts` | New `resetRendererState()` runs before every capture: `setRenderTarget(null)`, scissor off, full viewport, `autoClear*` back on, `NoToneMapping`, exposure 1, sRGB output, clear color re-applied, explicit `clear()`. Recipes can no longer leak renderer state into each other. |
| Per-recipe warm-up | `src/engine/types.ts`, `thumbs.ts`, `harness.ts` | Optional `thumbnailWarmup?: number` on `RecipeMeta`. The thumbnailer uses it in place of the old fixed constant (default kept at 1.6s); the harness reduced-motion still frame uses it too (default 1.2s). |
| Seeded randomness | `src/engine/rng.ts` (new) | `createRng(seed)` — mulberry32 with `next/range/signed/int` helpers — plus `hashSeed(string)` for seeding from a slug. Tideline seeds from `hashSeed("tideline:<variant>")`; the existing ten recipes were left untouched. |

## Part B — the recipe

`src/recipes/scenes/tideline.ts`, category `landing`, registered at the top of
the array in `src/recipes/index.ts` (normal + `?raw` import) with the new
`{ id: "landing", label: "Landing" }` category entry.

Five layers, all driven by one seeded spline, drawn in the mandated order
(water body → grid → crest halo → crest core → foam) with `depthWrite: false`
and explicit `renderOrder` on each:

1. **Chart spline** — alternating trough/peak control points where troughs are
   forced monotonically non-decreasing, fed to
   `new THREE.CatmullRomCurve3(points, false, "centripetal")`. Input is
   sanitized (NaN/Infinity/near-duplicate points dropped) and sampled output is
   clamped to a running trough floor and to monotone x, so the tide can crest
   and fall but never dips below a previous low.
2. **Water body** — indexed grid mesh (320 × 19 vertices) hanging from the
   crest to the baseline; ShaderMaterial with a teal depth gradient and
   two-octave value-noise vertical filaments.
3. **Crest** — two quad ribbons (soft teal halo + thin bright core), width as a
   uniform. No `LineBasicMaterial`, no `linewidth` anywhere in `src/`.
4. **Foam** — 1.8k–3k additive point sprites on a canvas-generated radial
   gradient texture, rise-and-recycle lifetimes with sparkle, all placement
   from the seeded RNG.
5. **Grid** — quad-ribbon month lines clipped to the water surface, value lines
   only where the tide has risen past them, axis ticks and a baseline, faded by
   depth and laterally.

Crest undulation lives in one GLSL function, `crestOffset(t, time, swell)`,
shared verbatim by the water, ribbon, and foam shaders, so the three layers
breathe together with no CPU re-tessellation. Glow is additive blending only —
no `EffectComposer`, no external assets. `thumbnailWarmup: 3`.

The camera dollies every frame to "cover" the authored composition, so the
framing — and the calm left third reserved for a headline — survives any
viewport aspect ratio without exposing geometry edges.

## Two fixes found during visual verification

- **Ribbon spikes.** Offsetting the ribbon along curve normals fanned out into
  visible light spikes at the tight crest turns. Since the chart is a function
  graph, the ribbon now expands vertically instead, which cannot self-intersect.
- **Sunken water body.** The first depth ramp drove the deep color almost to
  black, so the water read as missing under additive blending. The ramp is
  slower now and the deep tone stays teal.

## Verification

- `npx tsc --noEmit` — clean.
- `npm run build` — clean (only the pre-existing "chunks larger than 500 kB"
  advisory about the `three` bundle).
- Sidebar shows a **Landing** group with Tideline; the browse page has a
  Landing filter chip and reports 11 recipes.
- Tideline's thumbnail renders bright and composed (non-black), and all ten
  existing recipes still produce their thumbnails — no engine regression from
  the state reset.
- All three variants switch and are visually distinct: `rising` (irregular
  wavelets, steady growth), `volatile` (more, deeper waves, brighter, faster),
  `calm` (smooth, low amplitude, dim).
- All five props respond live, no rebuild: `foam 0` clears the spray, `grid 1`
  brightens the lattice, `glow 2` lifts crest and water, `speed 0` freezes the
  scene (two captures four seconds apart are byte-identical), and toggling
  `swell` with time frozen changes the frame.

**Unverified:** the on-page FPS readout. The automated Chrome tab runs in the
background, where the browser throttles `requestAnimationFrame` to a couple of
frames per second, so the counter reads 0–2 regardless of scene cost — a
measurement artifact, not a performance result. The frame budget is small (five
draw calls, ~12k vertices, ≤3k point sprites, no postprocessing, no render
targets), but a foreground FPS check still needs a human at the browser.
