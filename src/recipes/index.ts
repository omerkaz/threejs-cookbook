import type { CategoryId, RecipeDef, RecipeMeta } from "../engine/types";

import tideline from "./scenes/tideline";
import tidelineSrc from "./scenes/tideline.ts?raw";
import paperRelief from "./scenes/paper-relief";
import paperReliefSrc from "./scenes/paper-relief.ts?raw";
import basilica from "./scenes/basilica";
import basilicaSrc from "./scenes/basilica.ts?raw";
import galaxySpiral from "./scenes/galaxy-spiral";
import galaxySpiralSrc from "./scenes/galaxy-spiral.ts?raw";
import starfieldWarp from "./scenes/starfield-warp";
import starfieldWarpSrc from "./scenes/starfield-warp.ts?raw";
import noiseWaves from "./scenes/noise-waves";
import noiseWavesSrc from "./scenes/noise-waves.ts?raw";
import fresnelOrb from "./scenes/fresnel-orb";
import fresnelOrbSrc from "./scenes/fresnel-orb.ts?raw";
import polyhedraLab from "./scenes/polyhedra-lab";
import polyhedraLabSrc from "./scenes/polyhedra-lab.ts?raw";
import wireframeTerrain from "./scenes/wireframe-terrain";
import wireframeTerrainSrc from "./scenes/wireframe-terrain.ts?raw";
import pbrGrid from "./scenes/pbr-grid";
import pbrGridSrc from "./scenes/pbr-grid.ts?raw";
import threePointStudio from "./scenes/three-point-studio";
import threePointStudioSrc from "./scenes/three-point-studio.ts?raw";
import lissajousOrbits from "./scenes/lissajous-orbits";
import lissajousOrbitsSrc from "./scenes/lissajous-orbits.ts?raw";
import pendulumWave from "./scenes/pendulum-wave";
import pendulumWaveSrc from "./scenes/pendulum-wave.ts?raw";

export interface Category {
  id: CategoryId;
  label: string;
}

export const categories: Category[] = [
  { id: "landing", label: "Landing" },
  { id: "geometry", label: "Geometry" },
  { id: "materials", label: "Materials" },
  { id: "shaders", label: "Shaders" },
  { id: "particles", label: "Particles" },
  { id: "lighting", label: "Lighting" },
  { id: "animation", label: "Animation" },
];

function withSource(meta: RecipeMeta, source: string): RecipeDef {
  return { ...meta, source };
}

/** Ordered registry — order defines prev/next navigation and grid order. */
export const recipes: RecipeDef[] = [
  withSource(tideline, tidelineSrc),
  withSource(paperRelief, paperReliefSrc),
  withSource(basilica, basilicaSrc),
  withSource(polyhedraLab, polyhedraLabSrc),
  withSource(wireframeTerrain, wireframeTerrainSrc),
  withSource(pbrGrid, pbrGridSrc),
  withSource(noiseWaves, noiseWavesSrc),
  withSource(fresnelOrb, fresnelOrbSrc),
  withSource(galaxySpiral, galaxySpiralSrc),
  withSource(starfieldWarp, starfieldWarpSrc),
  withSource(threePointStudio, threePointStudioSrc),
  withSource(lissajousOrbits, lissajousOrbitsSrc),
  withSource(pendulumWave, pendulumWaveSrc),
];

export function findRecipe(slug: string): RecipeDef | undefined {
  return recipes.find((r) => r.slug === slug);
}

export function categoryLabel(id: CategoryId): string {
  return categories.find((c) => c.id === id)?.label ?? id;
}

export function recipesByCategory(id: CategoryId): RecipeDef[] {
  return recipes.filter((r) => r.category === id);
}
