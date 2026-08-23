# Basilica — build report

Third landing-page hero recipe: a monumental brutalist colonnade pierced by a
volumetric shaft of light, sold on stillness. `src/recipes/scenes/basilica.ts`
(~700 lines, cookbook header included), registered in `src/recipes/index.ts`
directly after Paper Relief. Zero assets, no postprocessing, no shadow maps.

## How it is built

1. **Colonnade.** Two inner rows of concrete slabs (2.6 wide, 36 tall, every
   6.5 units of depth) plus a sparser outer row offset by half a bay so it
   shows through the gaps. All of it recedes into `FogExp2` darkness.
2. **Concrete without textures.** Four `BoxGeometry` variants are tinted per
   vertex with `fbm2` from `src/engine/noise.ts` — broad vertical streaking
   plus a triangle-wave darkening at formwork seams — and multiplied onto one
   shared `MeshStandardMaterial` via `vertexColors`. Fragment cost is zero;
   the whole colonnade is 26 draw calls against one material.
3. **The shaft.** 2–3 stacked quads per beam. Each quad is a ribbon whose
   `position` attribute is the beam axis itself; the vertex shader offsets
   each edge along `cross(axis, toCamera)` in view space — a cylindrical
   billboard, so the beam always presents its full width and, having no
   volume, can never produce an intersection seam against concrete. The
   fragment profile is `pow(1 - u², softness)` for the halo plus a tight
   gaussian core, faded at both ends along the axis, times an `FogExp2`-shaped
   depth fade. Additive, `depthWrite: false`.
4. **Floor pool.** An additive radial-gradient plane where the beam lands,
   plus a longer, dimmer copy stretched toward the camera as a wet-slab
   reflection. One shared `ShaderMaterial` for all pools.
5. **Base uplights.** Additive gradient ribbons pinned to the inner column
   faces with a soft disc of spill on the slab, merged into a single
   vertex-alpha buffer — one draw call for every uplight in the nave.
6. **Dust.** 620 additive point sprites (variant-scaled, capped at 900) whose
   brightness is `exp(-d²)` in the distance `d` to the nearest beam axis,
   computed in the vertex shader. Motes drift everywhere; only the ones near
   the axis light up, so there is no boundary to pop across. They rise on a
   wrapped lifetime with fades at both ends of the wrap.

`renderOrder`: uplights 5 → pools 6 → shaft quads 10 → dust 20.

## The two hard constraints, and how they are met

**The shaft is never clipped by a column — by geometry, not by a depth trick.**
The colonnade leaves an open slab `|x| < INNER_FACE` (4.6) between the rows.
Every beam is authored to stay inside that slab (widest excursion is
`x = 3.1` plus a quad half-width of ~0.9), and the camera dolly is locked
inside it too (`|x| ≤ 0.45`). A slab is convex, so the segment from the camera
to any point of a beam also lies inside the slab — no column can ever come
between them. This also settles "the camera never crosses the shaft": the
dolly stays at `z ≥ 11.6` while every beam lives at `z ≤ 3.6`.

**Deterministic hero pose.** The dolly phase is
`((t - HERO_T) / 40) * 2π` and every offset is a `sin`/`1 - cos` term that is
exactly zero at phase 0, so `t = HERO_T = thumbnailWarmup = 6s` *is* the
composed pose. That is the frame the thumbnailer renders (it calls
`update(warmup, warmup)` once) and the frame the reduced-motion path renders.
`dolly = 0` parks the camera on the same pose rather than wherever it drifted
to. All scatter runs through `createRng(hashSeed("basilica:<variant>"))`.

Camera fit is a *contain* fit at the beam plane rather than Tideline's cover
fit: an interior must not crop its own subject, so narrow viewports pull the
camera back instead of losing the colonnade. Pitch is a fixed direction
(`lookAt` along a constant vector), so changing the fit distance never tumbles
the framing.

## Fixes found during visual verification

- **The beam read as a hard-edged stick.** The first falloff was
  `pow(1 - u, 1.5)` with high gains: the centre saturated to white and the
  tail died inside a couple of pixels, so a genuinely wide quad rendered as a
  thin bright bar. `pow(1 - u², softness)` is flat-topped and approaches zero
  smoothly at the quad edge; with the gains dropped so only the core clips, the
  beam finally reads as scattered light.
- **Everything was over-lit.** Key light 1.2, ambient 0.45 and uplight 0.7
  made the concrete a uniform warm tan — the opposite of the art target, where
  the columns are near-black except at their bases. Halved across all four
  variants.
- **Backticks in a GLSL comment.** A comment inside the shader template
  literal contained backticks, which terminated the template and produced an
  esbuild parse error. Shader comments are now plain prose.
- **Noon's shafts ended mid-frame.** Their upper ends were at `y = 15`, below
  the top of the frame; raised to 20–24 so they leave the viewport.

## Verification

- `npx tsc --noEmit` — clean. `npm run build` — clean apart from the
  pre-existing "chunks larger than 500 kB" advisory about the `three` bundle.
- Browse page reports **13 recipes**; all **14 images** on the grid report
  `complete && naturalWidth > 0` — the twelve pre-existing thumbnails still
  render, so the new recipe causes no engine regression.
- **The thumbnail is the composed hero pose**, not a mid-dolly angle: the
  Basilica card shows the colonnade, the diagonal beam and the floor pool in
  the same framing as the live scene at `dolly = 0`.
- **All four variants are distinct and were captured:** `dawn` (warm pale-gold
  diagonal beam, cool gray concrete), `noon` (three near-white vertical shafts,
  brightest concrete, highest contrast), `bluehour` (cold blue-steel beam,
  near-black floor), `alert` (deep red beam mirrored to the left over near-black
  concrete — restrained, not neon).
- **All five props respond**, measured as the mean absolute luminance change
  over the canvas region between two screenshots (default state vs. changed):

  | Prop | Change | Mean abs diff | Pixels changed > 12 |
  |---|---|---|---|
  | intensity | 1 → 0 | 7.71 | 9.9% |
  | intensity | 1 → 2.5 | 8.05 | 10.9% |
  | haze | 1 → 0 | 3.53 | 7.8% |
  | haze | 1 → 2 | 6.59 | 14.4% |
  | uplight | 1 → 0 | 1.71 | 3.8% |
  | uplight | 1 → 2 | 1.75 | 3.9% |
  | dust | 1 → 0 (rebuild) | 0.08 | 0.0% |
  | dust | 1 → 1.5 (rebuild) | 0.08 | 0.0% |

  `intensity = 0` removes the beam, both pools and the dust entirely (verified
  visually as well as numerically). The dust deltas are small because the motes
  are deliberately tiny and dim; the rebuild path runs cleanly and the mote
  count visibly changes.
- **`dolly = 0` freezes the camera.** Two captures eight seconds apart differ
  by a mean of 0.016 with *no* pixel changing more than 12/255 — the residual is
  the slow dust drift and the beam's breathing. The same measurement at
  `dolly = 2` gives a mean of 0.874 with 1.56% of pixels changing significantly.
- **Aspect ratios:** shrinking the canvas to 340×620 (portrait, aspect 0.55)
  keeps the whole composition — the contain fit pulls the camera back, the
  colonnade still frames both sides, and the beam's soft head fade means its
  upper end dissolves rather than showing a cut edge.

**Unverified:** the on-page FPS readout. The automated Chrome tab is not being
painted (an in-page `requestAnimationFrame` probe counted zero frames over
three seconds), so the counter reads 0 regardless of scene cost — the same
measurement artifact the Tideline and Paper Relief reports describe. The frame
budget is small by construction: ~30 opaque draw calls against two standard
materials, one merged uplight buffer, 2–6 additive quads for the beams, two
gradient planes per beam and ≤900 point sprites, with no render targets and no
postprocessing. A foreground FPS check still needs a human at the browser.
