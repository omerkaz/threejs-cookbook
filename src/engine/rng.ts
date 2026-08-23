/**
 * Deterministic pseudo-random numbers.
 *
 * Recipes that place things stochastically (particles, jitter, scatter) must
 * be reproducible: the thumbnailer and the reduced-motion still frame render
 * a single frame, and `Math.random()` would make that frame different every
 * time. `mulberry32` is a 32-bit generator — small, fast, good enough for
 * visual scatter, and identical across runs for a given seed.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform float in [-spread, spread). */
  signed(spread: number): number;
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number;
}

/** mulberry32 — a compact, well-distributed 32-bit PRNG. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    signed: (spread) => (next() * 2 - 1) * spread,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
  };
}

/** Stable 32-bit hash of a string — handy for seeding from a slug/variant. */
export function hashSeed(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
