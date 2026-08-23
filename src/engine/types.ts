import type * as THREE from "three";

export type PropValues = Record<string, number>;

export interface PropDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** When true, changing this prop tears the scene down and rebuilds it. */
  rebuild?: boolean;
}

export interface VariantDef {
  id: string;
  label: string;
}

export type CategoryId =
  | "landing"
  | "geometry"
  | "materials"
  | "shaders"
  | "particles"
  | "lighting"
  | "animation";

/** What a recipe receives when it is (re)built. */
export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  variant: string;
  props: PropValues;
}

/** What a recipe hands back to the harness. */
export interface SceneBuild {
  /** Advance the simulation. `elapsed` and `dt` are seconds. */
  update?(elapsed: number, dt: number): void;
  /**
   * Apply changed props without a rebuild. Return true when handled;
   * returning false (or omitting the method) asks the harness to rebuild.
   */
  applyProps?(props: PropValues): boolean;
  /** Extra cleanup beyond the harness' scene-graph disposal. */
  dispose?(): void;
}

export interface RecipeMeta {
  slug: string;
  title: string;
  category: CategoryId;
  description: string;
  tags: string[];
  variants: VariantDef[];
  props: PropDef[];
  /**
   * Seconds of simulated time to advance before capturing a single still
   * frame (thumbnail, reduced-motion render). Slow-blooming scenes need more
   * than the 1.6s default to compose. Keep it deterministic: seeded RNG only.
   */
  thumbnailWarmup?: number;
  create(ctx: SceneContext): SceneBuild;
}

export interface RecipeDef extends RecipeMeta {
  /** Raw TypeScript source of the recipe module, for display and copying. */
  source: string;
}

export function defaultProps(recipe: RecipeMeta): PropValues {
  const out: PropValues = {};
  for (const p of recipe.props) out[p.key] = p.default;
  return out;
}
