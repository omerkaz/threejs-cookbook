# Reference board — ThreeUI hero library

Calibration targets for the quality loop. Full standalone sources are publicly
served at `threeui.com/landing-pages/*.html` (SPA routes like
`/hero/sylva/living-green` are shells; the .html files are the real pages).
Local copies studied under /tmp/threeui/refs/.

**Working rule (set 2026-01):** lift craft vocabulary freely — tone curves,
easing tokens, noise helpers, density/distribution shaping, choreography
patterns, GLSL fragments. Transform identity — subject, composition, story,
palette — because distinctiveness from ThreeUI is our commercial asset.
Pro-tier files: technique notes only.

## Library index (verified fetchable, signatures scanned)

| File | Size | Signature | Best reference for |
|---|---|---|---|
| inner-green-3d.html (Sylva) | 198 KB | 9 shaders, 0 lights, ACES+HDR, no post | Paper Relief, engine baseline — see reference-sylva-notes.md |
| tidecrest-hero.html | 60 KB | 9 shaders, 0 lights, half-res UnrealBloom | **Tideline retrofit** — deep notes below |
| kage.html | 244 KB | 7 shaders + 8 lights + fog + instancing | Inkfall (dark editorial), preloader/reveal choreography |
| orrery.html | 114 KB | 11 shaders + 5 lights | Orbital Archive redesign |
| japanese-tower.html | 2.4 MB | 6 lights, 5 InstancedMesh, embedded assets | Basilica (monumental + atmosphere) |
| cathode.html / lumen.html | 45/75 KB | 6 shaders, 0 lights | Emberworks (luminous subject on dark) |
| meng-to-sketchbook.html | 46 KB | CSS-only | Entrance/reveal patterns without WebGL |

(noctiluca/sekitei URLs serve a fallback page — identical hashes — skip.)

## Tidecrest deep notes (Tideline's calibration target)

- **Half-res bloom**: UnrealBloomPass sized at `w*dpr*0.5, h*dpr*0.5` — the
  affordable glow pass we debated; he ships it.
- **Air color**: single `uHaze` "the colour the air itself glows" — every
  material lerps toward it with depth `(1.0 - vT)`. One uniform gives the
  whole scene atmospheric unity. Adopt in Tideline (and Basilica).
- **Screen-uniform density**: particle grid counts follow the window —
  "a particle sits roughly every 4.6px across and 6px down whatever the
  window is." Density is a screen-space constant, not a world constant;
  that's why it reads crisp at every viewport.
- **Reference-frame point sizing**: `uPixK = h/720` scales point sizes to a
  720px design frame — device-consistent weight.
- **Occluder solid**: the terrain field drawn again as a dark solid so near
  ridges hide point rows behind them — hidden-line aesthetic without
  raycasting.
- **Mirrored ridges** into the sea for reflections (geometry flip + fade),
  not screen-space reflection.
- **Aspect-adaptive pitch**: camera pitch eases down as aspect narrows —
  composition survives portrait.
- **Resize → rebuild**: when rotation outgrows the built spread, grids
  rebuild rather than stretch.
- **In-page design panel**: a typography prototyping panel ships inside the
  file — tuning UI lives next to the work. Knob culture again.

## Cross-library patterns (seen in 2+ files)

1. Lighting is optional: his best organic scenes paint light in shaders
   (Sylva, Tidecrest, Cathode); lit-geometry scenes (Tower, Kage) reserve
   lights for architecture.
2. Glow is contextual: HDR-into-ACES when the scene can carry it (Sylva);
   half-res bloom when points need it (Tidecrest). Both cheap.
3. Depth = color wash toward one air tone, everywhere.
4. Density/size distributions are shaped (pow curves), never uniform.
5. Comments record iteration: tried → measured → kept or zeroed.
6. Every page choreographs its entrance; nothing just appears.

## Retrofit queue (order of expected delta)

1. **Tideline vs tidecrest**: air color, screen-uniform foam density,
   half-res bloom, reference-frame sizing, mirrored glints.
2. **Emberworks vs cathode/lumen + Sylva rules**: ACES exposure ~1.3, HDR
   emissive ramp past 1.0, spark size distribution pow-shaped.
3. **Basilica vs japanese-tower**: atmosphere/air wash, entrance.
4. **Paper Relief vs Sylva**: secondary motion (birds lag), entrance
   choreography, pointer presence.
5. **Inkfall vs kage**: dark editorial pacing, preloader/reveal language.
