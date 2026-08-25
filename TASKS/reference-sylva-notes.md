# Reference study: ThreeUI SylvaHero (inner-green-3d.html)

Source: https://threeui.com/landing-pages/inner-green-3d.html (197 KB, single
file, studied 2026-01). Notes are paraphrased technique extraction — no code
copied. Use for calibration and technique; originality stays ours.

## The headline finding: quality without postprocessing

Sylva uses **no EffectComposer, no bloom pass, and zero THREE lights**. The
premium glow comes from:

1. `ACESFilmicToneMapping` + `toneMappingExposure = 1.30`
2. **HDR-into-ACES**: albedo/emissive values deliberately pushed past 1.0 and
   let ACES compress them ("Albedo runs past 1 on purpose; it is HDR into
   ACES" — his comment). The tone curve does what we assumed bloom was for.
3. All lighting painted inside ~9 custom ShaderMaterials — no lighting rig at
   all. MeshBasicMaterial only for flat helpers.

→ Our scenes render with default tone mapping and clamped LDR colors. This is
likely the largest single visual gap, and it costs nothing to close.

## Craft patterns worth adopting

- **Named-knob culture**: every visual decision is a named, commented
  parameter. The liquid-metal button alone has ~40 knobs in 4 groups (field,
  rim, composite, ripple), each with a why-comment. Our scenes hard-code most
  look decisions; knobs (internal constants, not user props) make tuning
  loops fast.
- **Iteration evidence in comments**: features that didn't earn their cost are
  documented and disabled ("The filaments … aliased into stripes … so they
  are off", fineAmp: 0.0). Selection pressure applied inside one file.
- **Aerial perspective on the cheap**: far ridge reuses the near builder,
  pushed back and "washed into the air" (~0.46 lerp toward the air tone).
  Depth without fog tricks or extra materials.
- **Per-particle seed attributes**: pollen packs phase/speed/sway/size per
  particle, with size distribution shaped by pow(random, 2.2) — few big, many
  small. Reads organic instead of uniform.
- **Secondary motion**: butterfly wingtips lag the stroke ("a rigid flapping
  plate reads as paper"). Every animated element has follow-through.
- **Choreographed entrance**: masked wipes, dock tiles dropping in sequence,
  card plates resolving "like a low-bandwidth botanical transmission". The
  page arrives; it doesn't just appear. CSS easing tokens:
  cubic-bezier(.22,.61,.36,1) and (.16,1,.3,1).
- **Pointer presence**: parallax + a moss trail lifted off the ground by the
  cursor (launch velocity drag, slow lift, wander). The scene notices you.
- **Tab discipline**: paints one composed frame before the loop starts (an
  opened background tab shows a finished scene), holds the pulse when hidden.
- **DPR policy**: min(devicePixelRatio, small ? 1.6 : 2); antialias off on
  small screens.

## What this changes in our quality plan

1. ~~Un-ban bloom~~ → **adopt ACES + HDR values instead** (cheaper, and now
   proven at the exact quality bar we're chasing).
2. Emberworks pilot order: ACES/exposure + HDR emissive ramp first, then
   knob-ify the look constants, then motion (easing + secondary lag on
   sparks/smoke), then entrance/pointer presence.
3. Critique rubric additions: aerial-depth wash, size-distribution shaping,
   follow-through on all motion, composed first frame.
