# Task: Paper Relief — second landing-page hero recipe

## Goal

Build **Paper Relief** — a layered cut-paper mountain diorama in pastel light
mode — as the second recipe in the `landing` category. This is a sellable art
direction aimed at friendly SaaS (education, health, HR): handcrafted, calm,
approachable. It fills a real market gap: almost nobody ships light-mode WebGL
heroes.

**Art target:** `concepts/02-paper-relief.png` (open it). Match its mood:
6–8 stacked paper layers (blue distant ridges → green foothills → cream
foreground), soft shadows between layers, paper clouds and tiny paper birds in
the sky, generous calm sky in the upper-left where the headline sits. Match
mood, not pixels.

## Read first (in order)

1. `README.md` — project overview and recipe contract
2. `src/engine/types.ts`, `src/engine/harness.ts`, `src/engine/rng.ts`, `src/engine/noise.ts`
3. `src/recipes/scenes/tideline.ts` — the flagship recipe; follow its
   conventions (seeded RNG, cookbook-style header, layer ordering discipline)
4. `src/recipes/index.ts` — registration pattern (normal + `?raw` import)
5. `TASKS/tideline-report.md` — what the previous agent shipped (engine
   upgrades you can rely on: `resetRendererState`, `thumbnailWarmup`, seeded RNG)
6. `concepts/02-paper-relief.png` — the art target

## Hard constraints (from the multi-model review — non-negotiable)

- **No shadow maps.** Contact shadows between layers = thin dark gradient
  ribbon meshes attached (parented) to each layer's top edge, so parallax can
  never detach a shadow from its layer.
- **Fillrate budget (DPR 2, M1):** layers must be OPAQUE materials (flat/vertex
  colors, MeshBasicMaterial is fine — the paper look needs no lighting). No
  full-screen per-layer fragment noise. Paper grain, if any, must be one cheap
  pass or vertex-color jitter — or skip it; silhouette + palette carry the look.
- **Contour generation must not self-intersect:** sample each ridge profile at
  strictly monotone-increasing x with a minimum spacing, displace y only (use
  `fbm2` from `src/engine/noise.ts`), then build ShapeGeometry from the closed
  profile. No ExtrudeGeometry bevels needed — flat shapes stacked in z read as
  paper.
- **Seeded randomness** — all stochastic generation through
  `createRng(hashSeed("paper-relief:<variant>"))` so thumbnails are
  reproducible.
- **Light scene background** — set `scene.background` to the variant's sky
  color inside `create()` (it overrides the harness dark clear color). Verify
  the thumbnail is NOT dark.
- Zero external assets; no postprocessing; `depthWrite`/`renderOrder`
  discipline for any transparent element (clouds/haze).

## Scene composition

- Terrain fills the lower ~60%; sky upper 40%. Upper-LEFT stays calm (headline
  quiet zone) — clouds and birds live mostly upper-right.
- 6–8 ridge layers, back-to-front: far ridges cool/hazy (lerp toward sky
  color for atmospheric depth), near ridges warmer/darker pastels.
- Slow ambient motion: per-layer lateral drift at different rates (parallax),
  gentle vertical bob (sub-pixel calm), 2–4 paper birds (simple flat V shapes)
  gliding slowly, 2–3 paper clouds drifting.
- Optional foreground detail: a couple of flat paper trees/bushes on the
  nearest layer (simple triangle/circle shapes), like the art target.

## Variants (4)

- `alpine` — blue/green pastels, white-blue sky (default; matches art target)
- `coast` — teal water band + sand tones
- `dune` — warm sand/terracotta gradient
- `night` — deep navy diorama, pale paper moon, star dots (still paper-craft,
  not a space scene)

## Props (5)

- `depth` — z-spacing / parallax intensity (live)
- `drift` — ambient motion speed (live)
- `warmth` — palette hue/temperature shift (live — lerp layer colors)
- `ruggedness` — terrain noise amplitude (rebuild)
- `haze` — atmospheric fade strength toward horizon (live)

## Register + verify + commit

- Register in `src/recipes/index.ts` right after Tideline in the array.
- Cookbook-style header comment (the file is the displayed source).
- Verify: `npx tsc --noEmit` && `npm run build` clean; preview if browser
  tooling is available (state clearly if visual verification is pending);
  thumbnail must render light, not dark; all 4 variants distinct; all 5 props
  respond; existing 11 recipes unaffected.
- Commit (repo has a git remote — do NOT push):
  `feat(landing): Paper Relief cut-paper hero recipe`
- Write a short completion report to `TASKS/paper-relief-report.md`.

Work autonomously start to finish; do not wait for confirmation between steps.
