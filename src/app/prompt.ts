import type { PropValues, RecipeDef } from "../engine/types";
import noiseSource from "../engine/noise.ts?raw";

const USES_NOISE = /from ["']\.\.\/\.\.\/engine\/noise["']/;

/**
 * Full copyable source: the recipe module plus any small engine util it
 * imports, so the paste is self-contained apart from `three` itself.
 */
export function buildCode(recipe: RecipeDef): string {
  let out = recipe.source;
  if (USES_NOISE.test(recipe.source)) {
    out += `\n\n// --- engine/noise.ts (imported above) ---\n\n${noiseSource}`;
  }
  return out;
}

/** Instruction-wrapped variant for pasting into an AI coding agent. */
export function buildPrompt(recipe: RecipeDef, variant: string, props: PropValues): string {
  const propLines = recipe.props
    .map((p) => `- ${p.label} (${p.key}): ${props[p.key] ?? p.default} (range ${p.min}–${p.max})`)
    .join("\n");

  return [
    `Recreate the "${recipe.title}" Three.js scene described below in my project.`,
    ``,
    `Technique: ${recipe.description}`,
    `Active variant: ${variant}`,
    `Current prop values:`,
    propLines,
    ``,
    `Notes for integration:`,
    `- Requires only the "three" npm package (tested with three 0.185.x).`,
    `- The module exports a recipe object; call recipe.create({ scene, camera, variant, props })`,
    `  and drive the returned build.update(elapsed, dt) from your render loop.`,
    `- The "../../engine/types" import is type-only — inline those interfaces or strip types.`,
    `- Cap devicePixelRatio at 2 and dispose geometries/materials on teardown.`,
    ``,
    `Source:`,
    ``,
    "```ts",
    buildCode(recipe),
    "```",
  ].join("\n");
}
