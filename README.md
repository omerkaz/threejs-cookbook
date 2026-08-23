# threejs-cookbook

An open cookbook of interactive Three.js recipes — small, self-contained WebGL
studies with live previews, tweakable props, variants, and copyable source.
The site anatomy is a reproduction of [threeui.com](https://threeui.com) by
MengTo, rebuilt with original content and code.

## Run it

```bash
npm install
npm run dev        # Vite dev server
npm run build      # typecheck + production build (dist/)
npm run preview    # serve the production build
```

## What's inside

| Area | Path | Notes |
|---|---|---|
| Recipes | `src/recipes/scenes/*.ts` | 10 self-contained scene modules; each file is also the displayed source |
| Registry | `src/recipes/index.ts` | attaches `?raw` source, defines categories and ordering |
| Engine | `src/engine/harness.ts` | renderer + rAF lifecycle: DPR cap, resize, dispose, reduced-motion, context-loss |
| Thumbnails | `src/engine/thumbs.ts` | one shared hidden renderer draws each recipe once → cached PNG (avoids the WebGL context cap) |
| Theming | `src/app/theme.ts`, `src/styles.css` | light/dark/system × 5 palettes via `data-scheme` / `data-palette`, FOUC-safe inline script in `index.html` |
| Routing | `src/app/router.ts` | tiny hash router: `#/browse`, `#/recipe/:slug`, `#/installation`, `#/about` |

## Recipe contract

Each recipe exports a `RecipeMeta`: metadata (title, category, tags, variants,
prop definitions) plus a `create({ scene, camera, variant, props })` factory
returning `{ update?, applyProps?, dispose? }`. Props whose change can be
applied live return `true` from `applyProps`; anything else triggers a clean
rebuild. Copying a recipe out only requires the `three` package — the shared
noise util is appended to the copy automatically.

## Adding a recipe

1. Create `src/recipes/scenes/my-recipe.ts` exporting a `RecipeMeta`.
2. Register it in `src/recipes/index.ts` (normal import + `?raw` import).
3. `npm run build` — done: sidebar, grid, search, and thumbnails pick it up.
