import { CodeBlock } from "../components/CodeBlock";

const RUN_LOCAL = `git clone https://github.com/omerkaz/threejs-cookbook
cd threejs-cookbook
npm install
npm run dev`;

const INSTALL_THREE = `npm install --save-exact three
npm install -D @types/three   # TypeScript projects only`;

const MOUNT = `import * as THREE from "three";
import recipe from "./galaxy-spiral"; // any copied recipe module

const canvas = document.querySelector("canvas")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setClearColor(0x0a0a0c, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
camera.position.set(0, 0, 8);

const props = Object.fromEntries(recipe.props.map((p) => [p.key, p.default]));
const build = recipe.create({
  scene,
  camera,
  variant: recipe.variants[0].id,
  props,
});

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

let last = performance.now();
let elapsed = 0;
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  elapsed += dt;
  build.update?.(elapsed, dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);`;

export function InstallationPage() {
  return (
    <div className="prose">
      <span className="eyebrow">Getting started</span>
      <h1 style={{ letterSpacing: "-0.03em" }}>Installation</h1>
      <p>
        Recipes are plain TypeScript modules over the <code>three</code> package.
        Run the cookbook locally to browse and tweak, or lift a single recipe
        into your own project — there is no library to depend on.
      </p>

      <h2>Run the cookbook locally</h2>
      <div className="step">
        <span className="step-num">1</span>
        <div>
          <h3>Clone and start the dev server</h3>
          <p>Node 20+ recommended. Vite serves the site with hot reload:</p>
          <CodeBlock code={RUN_LOCAL} />
        </div>
      </div>

      <h2>Use a recipe in your project</h2>
      <div className="step">
        <span className="step-num">1</span>
        <div>
          <h3>Install three</h3>
          <p>Recipes are tested against three 0.185 — pin exact to avoid API churn:</p>
          <CodeBlock code={INSTALL_THREE} />
        </div>
      </div>
      <div className="step">
        <span className="step-num">2</span>
        <div>
          <h3>Copy the recipe module</h3>
          <p>
            Use the <strong>Copy Code</strong> button on any recipe page. The
            copy is self-contained: recipes that use the tiny noise util get it
            appended automatically. The <code>engine/types</code> import is
            type-only — inline the interfaces or strip types for JavaScript.
          </p>
        </div>
      </div>
      <div className="step">
        <span className="step-num">3</span>
        <div>
          <h3>Mount it with a plain render loop</h3>
          <p>
            No framework required. Create a renderer, call{" "}
            <code>recipe.create()</code>, and drive <code>build.update()</code>:
          </p>
          <CodeBlock code={MOUNT} />
        </div>
      </div>

      <h2>Requirements</h2>
      <table className="spec-table">
        <tbody>
          <tr>
            <th>three</th>
            <td>0.185.x (pinned in this repo)</td>
          </tr>
          <tr>
            <th>Browser</th>
            <td>WebGL-capable, hardware acceleration on</td>
          </tr>
          <tr>
            <th>TypeScript</th>
            <td>Optional — modules strip cleanly to JS</td>
          </tr>
          <tr>
            <th>Assets</th>
            <td>None — every recipe is procedural</td>
          </tr>
        </tbody>
      </table>

      <h2>Teardown checklist</h2>
      <ul>
        <li>Cancel the <code>requestAnimationFrame</code> loop.</li>
        <li>Dispose geometries, materials, and the renderer on unmount.</li>
        <li>Cap <code>devicePixelRatio</code> at 2 for mobile GPUs.</li>
        <li>
          Respect <code>prefers-reduced-motion</code> — render a still frame
          instead of looping.
        </li>
      </ul>
    </div>
  );
}
