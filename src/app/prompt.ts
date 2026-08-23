import type { PropValues, RecipeDef } from "../engine/types";
import rngSource from "../engine/rng.ts?raw";
import noiseSource from "../engine/noise.ts?raw";
import feedbackSource from "../engine/feedback.ts?raw";

interface CopyableModule {
  /** Path as it appears in a recipe's import statement. */
  path: string;
  source: string;
}

/**
 * Engine utilities a recipe may carry along when copied. This is an explicit
 * whitelist in dependency order, not an import graph walk: these modules are
 * small, dependency-free and hand-audited, and a traversal would happily drag
 * the whole engine (or a cycle) into somebody's clipboard.
 */
const COPYABLE: CopyableModule[] = [
  { path: "engine/rng", source: rngSource },
  { path: "engine/noise", source: noiseSource },
  { path: "engine/feedback", source: feedbackSource },
];

function importsModule(source: string, path: string): boolean {
  const name = path.split("/").pop() ?? path;
  return new RegExp(`from ["'][./]*(?:engine/)?${name}["']`).test(source);
}

/**
 * Full copyable source: the recipe module plus any small engine util it
 * imports, so the paste is self-contained apart from `three` itself. Each
 * util is appended at most once, in dependency order.
 */
export function buildCode(recipe: RecipeDef): string {
  const parts = [recipe.source];
  for (const mod of COPYABLE) {
    if (!importsModule(recipe.source, mod.path)) continue;
    parts.push(`// --- ${mod.path}.ts (imported above) ---\n\n${mod.source}`);
  }
  return parts.join("\n\n");
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
    `- The module exports a recipe object; call recipe.create({ scene, camera, renderer, variant, props })`,
    `  and drive the returned build.update(elapsed, dt) from your render loop.`,
    `- If the build exposes preRender(dt), call it right before renderer.render() each frame;`,
    `  it draws into its own render targets and restores the default framebuffer.`,
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
