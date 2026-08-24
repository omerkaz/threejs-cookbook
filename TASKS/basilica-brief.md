# Task: Basilica — third landing-page hero recipe

## Goal

Build **Basilica** — monumental brutalist concrete columns pierced by a
volumetric shaft of light — as the third recipe in the `landing` category.
Sellable mood: gravitas for security/compliance/banking-infra brands. Stillness
is the feature: this is the quietest, slowest scene in the collection.

**Art target:** `concepts/04-basilica.png` (open it). Massive concrete columns
receding into darkness, one diagonal god-ray shaft with drifting dust, dim
floor uplights at column bases, centered headline sitting inside the lit zone.
Match mood, not pixels.

## Read first (in order)

1. `README.md`
2. `src/engine/types.ts`, `src/engine/harness.ts`, `src/engine/rng.ts`, `src/engine/noise.ts`
3. `src/recipes/scenes/tideline.ts` and `src/recipes/scenes/paper-relief.ts` —
   follow their conventions (seeded RNG, cookbook header, renderOrder
   discipline, camera composition fitting)
4. `TASKS/tideline-report.md`, `TASKS/paper-relief-report.md` — engine
   capabilities you can rely on (`resetRendererState`, `thumbnailWarmup`,
   seeded RNG)
5. `concepts/04-basilica.png` — the art target

## Hard constraints (from the multi-model review — non-negotiable)

- **No naive additive cone.** A 3D cone mesh slicing through columns produces
  hard geometric intersection lines and glows through the concrete. Build the
  shaft from **camera-facing billboard planes** (2–4 stacked quads) with a
  custom shader: soft radial/edge falloff, brighter white-hot core, additive
  blending, `depthWrite: false`. Position and composition must guarantee the
  shaft quads never visually cross a column silhouette in front of it — solve
  by placement (shaft lives in the open corridor between columns), not by
  depth-texture tricks.
- **Camera never enters or crosses the shaft volume.** Lock the dolly path so
  the shaft is always viewed from outside; no clipping through columns either.
- **Dust must fade at the shaft boundary** — radial falloff on particle
  opacity, no hard visibility pop at the edge (drift particles everywhere, but
  brightness peaks inside the shaft and falls to near-zero outside).
- **Deterministic hero pose:** the scene must look composed at the
  reduced-motion/thumbnail frame. Set `thumbnailWarmup` such that the dolly
  sits at the ideal art-target angle at that time (e.g. dolly phase defined so
  t=warmup ≡ hero pose).
- **Concrete without textures:** per-vertex or cheap fragment value-noise tint
  variation on MeshStandardMaterial (import from `src/engine/noise.ts` for CPU
  vertex tinting, or a small GLSL noise — keep the fragment cost low; the
  scene is mostly dark, don't burn fillrate on invisible detail).
- Seeded randomness via `createRng(hashSeed("basilica:<variant>"))`; zero
  assets; no postprocessing; explicit `renderOrder` on transparent layers
  (shaft quads → dust).

## Scene composition

- Two colonnade rows receding toward a dark vanishing point; open corridor in
  the center. Camera on a very slow dolly (full loop ~40s) drifting forward
  and slightly laterally — barely perceptible motion.
- One diagonal light shaft entering high (upper area) and landing on the
  corridor floor as a soft elliptical glow pool (gradient plane, additive).
- Dim warm uplights at column bases: small vertical gradient ribbons against
  the column faces (cheap fake, like the art target), plus a faint floor
  reflection gradient.
- Dust: 400–900 slow-drifting particles, additive, tiny, brightness shaped by
  distance to the shaft axis.
- **Headline quiet zone: the center** of the frame inside/around the shaft —
  keep the corridor center visually calm and column-free; dust stays subtle
  there.

## Variants (4)

- `dawn` — warm pale-gold shaft, cool gray concrete (default; art target)
- `noon` — near-white vertical shafts (2–3 parallel), highest contrast
- `bluehour` — cold blue-steel shaft, darker floor
- `alert` — deep red accent shaft, near-black concrete (security "incident"
  mood — still restrained, not neon)

## Props (5)

- `intensity` — shaft + floor-pool brightness (live, uniform)
- `dust` — particle density (rebuild)
- `dolly` — camera drift speed, 0 = locked hero pose (live)
- `haze` — ambient fog/depth-fade strength (live — scene.fog or shader fade)
- `uplight` — column base uplight strength (live)

## Register + verify + commit

- Register in `src/recipes/index.ts` after Paper Relief; add cookbook-style
  header (file is the displayed source).
- Verify: `npx tsc --noEmit` && `npm run build` clean; thumbnail renders the
  composed hero pose (not a mid-dolly awkward angle); all 4 variants distinct;
  all 5 props respond (dolly=0 must freeze the camera); existing 12 recipes
  unaffected. State clearly if visual verification is pending.
- Commit (do NOT push): `feat(landing): Basilica volumetric-shaft hero recipe`
- Write `TASKS/basilica-report.md`.

Work autonomously start to finish; do not wait for confirmation between steps.
