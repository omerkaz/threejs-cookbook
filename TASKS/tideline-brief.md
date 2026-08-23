# Task: Tideline — first sellable landing-page hero recipe

## Goal

Build **Tideline** — "a revenue chart line that is literally a luminous ocean
tide" — as the first recipe of a new `landing` category in this repo
(threejs-cookbook). This is a *sellable art direction*, not a tech demo: the
scene must look like the art target and hold a quiet zone for headline text.

**Art target:** `concepts/05-tideline.png` (open it — match its mood: dark navy,
teal luminous crest with foam particles, translucent water body, faint
engineering grid + axis ticks under the water). Match mood, not pixels.

## Read first (in order)

1. `README.md` — project overview and recipe contract
2. `src/engine/types.ts`, `src/engine/harness.ts`, `src/engine/thumbs.ts`
3. `src/recipes/scenes/noise-waves.ts` — reference recipe (ShaderMaterial + uniforms style)
4. `src/recipes/index.ts` — how recipes register (normal + `?raw` import)
5. `concepts/05-tideline.png` — the art target

## Part A — harness upgrades (do these FIRST, they are prerequisites)

A multi-model review (Gemini/GPT-5.5/DeepSeek) mandated these engine fixes:

1. **Thumbnailer state isolation** (`src/engine/thumbs.ts`): before each
   thumbnail render, reset renderer state — `setRenderTarget(null)`, clear
   color, tone mapping, `autoClear` — so recipes can't leak state into each
   other.
2. **Per-recipe warm-up** — add optional `thumbnailWarmup?: number` (seconds)
   to `RecipeMeta`; thumbnailer uses it instead of the fixed 1.6s constant
   (keep 1.6 as default). Harness reduced-motion still frame should use it too.
3. **Seeded randomness** — add `src/engine/rng.ts`: tiny deterministic PRNG
   (mulberry32 is fine). Tideline must use it for all stochastic placement so
   thumbnails and reduced-motion frames are reproducible. Do NOT rewrite the
   existing 10 recipes.

## Part B — the Tideline recipe

`src/recipes/scenes/tideline.ts`, category `landing` (add the category to
`src/recipes/index.ts` categories list, label "Landing").

### Hard constraints from the review (non-negotiable)

- **No `THREE.LineBasicMaterial` linewidth reliance** — line width is capped at
  1px on ANGLE/Windows. Grid lines and the crest stroke must be built from quad
  ribbons (triangle strips / thin PlaneGeometry segments) or shader-drawn on a
  full-screen-ish plane. Your choice, but no `linewidth > 1`.
- **Centripetal CatmullRom** (`new THREE.CatmullRomCurve3(pts, false,
  "centripetal")`) or monotonic interpolation for the chart spline — no
  overshoot below previous lows (it must read as a plausible revenue chart).
- **Sanitize curve input** — filter NaN/Infinity/duplicate points before
  building the curve.
- **No postprocessing / EffectComposer.** Glow = additive blending + soft
  sprite textures (canvas-generated radial gradient textures are allowed).
- **Transparency ordering** — set `depthWrite: false` + explicit `renderOrder`
  on all transparent layers (water body → grid → crest → foam).
- **Zero external assets.** Procedural only.

### Scene composition (match art target)

- Dark navy background (#050b14 area), scene bg can stay the harness default
  or set scene.background — keep consistent with existing recipes.
- Rising chart curve from lower-left to upper-right; left ~40% of frame stays
  calm/empty (the headline quiet zone — verify text would sit there).
- Crest: luminous teal line (quad ribbon) + 2–3k foam particles jittered along
  the curve near the crest, additive, animated drift + sparkle.
- Water body: mesh filling area below the curve, custom ShaderMaterial,
  vertical teal gradient fading to transparent at depth, subtle noise shimmer.
- Grid: faint quad-ribbon grid + axis tick marks beneath the water, depth-faded.
- Gentle continuous motion: crest undulates slightly (vertex noise), foam
  drifts; the chart shape itself stays stable.

### Variants (3)

- `rising` — steady growth curve, calm teal (default)
- `volatile` — jagged curve, brighter foam, faster motion
- `calm` — smoother low-amplitude curve, dimmer, slow

### Props (live where possible)

- `swell` (crest undulation amplitude), `foam` (particle intensity/count
  scale — rebuild ok), `glow` (crest/foam brightness), `speed` (motion rate),
  `gridOpacity` (live)

### Register + source

- Register in `src/recipes/index.ts` with `?raw` import, place at the TOP of
  the recipes array (it's the flagship).
- The recipe file doubles as displayed source — write it cookbook-style with a
  header comment explaining the technique.

## Verification (must pass before you report done)

```bash
npx tsc --noEmit
npm run build
```

Then run `npm run preview -- --port 4821` and verify in a browser if you have
browser tooling; otherwise state clearly that visual verification is pending.
Check: recipe appears in sidebar under Landing, thumbnail renders non-black,
detail page runs at 55+ FPS, all 5 props respond, all 3 variants switch.

## Acceptance criteria

- [ ] tsc + build clean
- [ ] Thumbnailer state reset + `thumbnailWarmup` + seeded RNG landed
- [ ] No linewidth usage; centripetal CatmullRom; input sanitized
- [ ] Left-side quiet zone visually calm in default variant
- [ ] Reduced-motion still frame looks composed (use thumbnailWarmup ~3s)
- [ ] Existing 10 recipes still build and render (no engine regressions)

Work autonomously start to finish. Do not wait for confirmation between steps.
When done, write a short completion report to `TASKS/tideline-report.md`.
