# Task: Emberworks — fourth landing-page hero recipe (stylize-first)

## Goal

Build **Emberworks** — a molten metal pour in a dark forge — as the fourth
`landing` recipe. Sellable mood: "we build / ship in metal" for dev-tools,
CI/CD, and infrastructure brands.

**Verdict context:** the multi-model review rated this concept
**stylize-first** — the art target's photorealism is NOT the bar. Build a
confident stylized interpretation: emissive ribbon + sparks + smoke that carry
the mood. Do not chase photoreal metal.

**Art target:** `concepts/03-emberworks.png` (open it). Near-black forge, a
diagonal molten pour with white-hot core fading to deep orange edges, sparks
scattering with motion streaks, faint smoke, left side dark and calm for the
headline. Match mood, not pixels.

## Read first (in order)

1. `README.md`
2. `src/engine/types.ts`, `src/engine/harness.ts`, `src/engine/rng.ts`, `src/engine/noise.ts`
3. `src/recipes/scenes/tideline.ts`, `paper-relief.ts`, `basilica.ts` — follow
   established conventions (seeded RNG, cookbook header, renderOrder
   discipline, deterministic hero pose via `thumbnailWarmup`, camera
   composition fitting)
4. `TASKS/*-report.md` — engine capabilities and prior lessons
5. `concepts/03-emberworks.png` — the art target

## Hard constraints (from the multi-model review — non-negotiable)

- **NO screen-space heat haze.** No render-to-texture distortion pass, no
  EffectComposer — all three review models flagged this as a hidden
  postprocessing chain. Heat shimmer, if any, is done with subtle vertex
  wobble on the smoke/ribbon geometry or UV-space noise inside the ribbon's
  own fragment shader.
- **Pour deformation strategy:** `TubeGeometry` is static. Choose one and
  document it in the header comment: (a) deform in the vertex shader
  (noise-driven wobble around a fixed spine — recommended), or (b) keep the
  spine fixed and animate only the emissive flow pattern along the UVs. Do
  NOT rebuild geometry per frame.
- **Transparency ordering:** everything glowing is transparent. Explicit
  `renderOrder` and `depthWrite: false` on: smoke (back) → pour ribbon glow →
  sparks (front). The white-hot core pass can be opaque or additive, but the
  layering must be deliberate and commented.
- **Sparks:** 1–2k additive particles with gravity + upward burst at the
  impact point, stretched along velocity (quad billboards or
  `THREE.Points` with elongated sprite texture — your call), seeded RNG,
  recycle lifetimes. Radial brightness falloff — no hard pops.
- **Glow without bloom:** additive layering only — a wide soft "halo" ribbon
  pass behind the core ribbon (same spine, larger width, low alpha), plus a
  soft radial glow sprite at the impact pool. Canvas-generated gradient
  textures allowed.
- **Emissive ramp:** white-hot core → orange → deep red at edges, driven by a
  temperature-style gradient in the fragment shader (approximate blackbody:
  white #fff6e0 → #ff9a3c → #d84315 → transparent). The pour is the ONLY
  light source: a single dim orange PointLight near the impact pool may fake
  bounce onto nearby dark shapes; no other lights.
- Seeded randomness (`hashSeed("emberworks:<variant>")`), zero assets, dark
  scene (harness default bg is fine), deterministic hero pose at
  `thumbnailWarmup`.

## Scene composition

- Pour enters from upper-right, falls diagonally to an impact pool at
  lower-center-right (matches art target). Crucible lip optional — a dark
  wedge silhouette at the top is enough.
- Impact pool: soft glowing ellipse + slow-pulsing brightness + spark
  emission origin.
- Faint dark silhouettes of anvil-like blocks at the bottom edge (simple dark
  boxes barely rimmed by the pour light) to ground the scene.
- Smoke: 6–12 large, very-low-alpha soft sprites drifting slowly upward near
  the pour.
- **Headline quiet zone: LEFT third** — keep it near-black and calm; sparks
  must not travel there.

## Variants (3)

- `steel` — classic orange-white pour (default; art target)
- `gold` — deeper amber/gold ramp, slower pour, richer glow
- `plasma` — blue-white electric ramp (#e0f0ff core → #4a8aff → #1a3a8a),
  faster sparks — restrained, not neon

## Props (5)

- `pour` — flow rate / ribbon animation speed (live, uniform)
- `sparks` — spark emission density (rebuild)
- `heat` — overall emissive intensity + point light strength (live)
- `turbulence` — ribbon wobble amplitude (live, uniform)
- `smoke` — smoke opacity (live)

## Register + verify + commit

- Register in `src/recipes/index.ts` after Basilica; cookbook-style header.
- Verify: `npx tsc --noEmit` && `npm run build` clean; thumbnail shows the
  composed pour (not an empty pre-warm frame — tune `thumbnailWarmup`); all 3
  variants distinct; all 5 props respond; left third stays dark in all
  variants; existing 13 recipes unaffected. State clearly if visual
  verification is pending.
- Commit (do NOT push): `feat(landing): Emberworks molten-pour hero recipe`
- Write `TASKS/emberworks-report.md`.

Work autonomously start to finish; do not wait for confirmation between steps.
