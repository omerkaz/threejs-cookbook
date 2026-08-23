export function AboutPage() {
  return (
    <div className="prose">
      <span className="eyebrow">About</span>
      <h1 style={{ letterSpacing: "-0.03em" }}>Three.js Cookbook</h1>
      <p>
        A small, open gallery of <strong>self-contained Three.js studies</strong>.
        Each recipe teaches one technique — a shader term, a buffer-attribute
        trick, a lighting rig — with live props so you can feel the parameters,
        variants that show the same idea from different angles, and source that
        pastes into any project.
      </p>

      <h2>Principles</h2>
      <ul>
        <li>
          <strong>Zero assets.</strong> Everything is procedural: no textures,
          models, or HDRIs to load.
        </li>
        <li>
          <strong>One dependency.</strong> Recipes need only the{" "}
          <code>three</code> package; the shared noise util travels with the
          copy.
        </li>
        <li>
          <strong>Honest lifecycles.</strong> Every scene disposes what it
          allocates — geometries, materials, render loops.
        </li>
        <li>
          <strong>Readable over clever.</strong> The displayed source is the
          exact module the preview runs.
        </li>
      </ul>

      <h2>How the previews work</h2>
      <p>
        The detail page mounts a single live renderer per recipe. Grid
        thumbnails come from <strong>one shared hidden renderer</strong> that
        draws each recipe's first frame once and caches it as an image — so the
        browse grid never runs into the browser's WebGL context limit.
      </p>

      <h2>Credits</h2>
      <p>
        The site anatomy — sidebar tree, variant badges, palette-cycling theme
        switcher, prompt-copyable components — is an homage to{" "}
        <a href="https://threeui.com" target="_blank" rel="noopener noreferrer">
          threeui.com
        </a>{" "}
        by MengTo. All recipes, code, and text here are original work built on{" "}
        <a href="https://threejs.org" target="_blank" rel="noopener noreferrer">
          three.js
        </a>
        .
      </p>
    </div>
  );
}
