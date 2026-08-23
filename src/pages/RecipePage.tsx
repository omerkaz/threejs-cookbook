import { useEffect, useRef, useState } from "react";
import { categoryLabel, findRecipe, recipes } from "../recipes";
import { buildCode, buildPrompt } from "../app/prompt";
import { copyText } from "../app/clipboard";
import { navigate } from "../app/router";
import { defaultProps, type PropValues, type RecipeDef } from "../engine/types";
import { PreviewCanvas } from "../components/PreviewCanvas";
import { CodeBlock } from "../components/CodeBlock";
import { NotFoundPage } from "./NotFoundPage";

export function RecipePage({ slug }: { slug: string }) {
  const recipe = findRecipe(slug);
  if (!recipe) return <NotFoundPage path={`/recipe/${slug}`} />;
  // Key by slug so per-recipe state (variant, props) resets on navigation.
  return <Workbench key={recipe.slug} recipe={recipe} />;
}

type CopyFeedback = "idle" | "copied" | "failed";

function Workbench({ recipe }: { recipe: RecipeDef }) {
  const [variant, setVariant] = useState(recipe.variants[0]?.id ?? "default");
  const [props, setProps] = useState<PropValues>(() => defaultProps(recipe));
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedback, setFeedback] = useState<CopyFeedback>("idle");
  const feedbackTimer = useRef<number>();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => window.clearTimeout(feedbackTimer.current), []);

  // Close the copy menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  async function copy(kind: "code" | "prompt"): Promise<void> {
    setMenuOpen(false);
    const text =
      kind === "code" ? buildCode(recipe) : buildPrompt(recipe, variant, props);
    const ok = await copyText(text);
    setFeedback(ok ? "copied" : "failed");
    window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setFeedback("idle"), 1800);
  }

  const index = recipes.findIndex((r) => r.slug === recipe.slug);
  const prev = index > 0 ? recipes[index - 1] : null;
  const next = index < recipes.length - 1 ? recipes[index + 1] : null;

  const liveProps = recipe.props.filter((p) => !p.rebuild).length;
  const rebuildProps = recipe.props.length - liveProps;

  return (
    <article>
      <header className="detail-head">
        <div>
          <span className="eyebrow">{categoryLabel(recipe.category)}</span>
          <h1>{recipe.title}</h1>
        </div>
        <div className="copy-group" ref={menuRef}>
          <button className="copy-main" onClick={() => copy("code")}>
            {feedback === "idle"
              ? "Copy Code"
              : feedback === "copied"
                ? "Copied ✓"
                : "Copy failed"}
          </button>
          <button
            className="copy-caret"
            aria-label="More copy options"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            ▾
          </button>
          {menuOpen && (
            <div className="copy-menu">
              <button onClick={() => copy("code")}>Copy code</button>
              <button onClick={() => copy("prompt")}>Copy as AI prompt</button>
            </div>
          )}
        </div>
      </header>

      <p className="detail-desc">{recipe.description}</p>

      <div className="detail-meta">
        {recipe.tags.map((tag) => (
          <span className="tag" key={tag}>
            {tag}
          </span>
        ))}
        <span className="tag">
          {recipe.variants.length} variant{recipe.variants.length === 1 ? "" : "s"}
        </span>
      </div>

      <PreviewCanvas recipe={recipe} variant={variant} props={props} />

      <div className="workbench">
        <section className="panel">
          <h2>Variants</h2>
          <div className="variant-list">
            {recipe.variants.map((v) => (
              <button
                key={v.id}
                className={`variant-item${v.id === variant ? " active" : ""}`}
                onClick={() => setVariant(v.id)}
              >
                <span>{v.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Props</h2>
          {recipe.props.map((prop) => (
            <div className="prop-row" key={prop.key}>
              <label className="prop-label">
                <span>
                  {prop.label}
                  {prop.rebuild ? " *" : ""}
                </span>
                <output>{formatValue(props[prop.key], prop.step)}</output>
              </label>
              <input
                type="range"
                min={prop.min}
                max={prop.max}
                step={prop.step}
                value={props[prop.key]}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value)) return;
                  setProps((current) => ({ ...current, [prop.key]: value }));
                }}
              />
            </div>
          ))}
          {rebuildProps > 0 && (
            <p className="palette-hint" style={{ textAlign: "left" }}>
              * rebuilds the scene when changed
            </p>
          )}
        </section>
      </div>

      <table className="spec-table">
        <tbody>
          <tr>
            <th>Runtime</th>
            <td>three 0.185 · WebGL</td>
          </tr>
          <tr>
            <th>Variants</th>
            <td>{recipe.variants.map((v) => v.label).join(" · ")}</td>
          </tr>
          <tr>
            <th>Props</th>
            <td>
              {liveProps} live{rebuildProps > 0 ? ` · ${rebuildProps} rebuild` : ""}
            </td>
          </tr>
          <tr>
            <th>Assets</th>
            <td>None — fully procedural</td>
          </tr>
          <tr>
            <th>Source</th>
            <td>src/recipes/scenes/{recipe.slug}.ts</td>
          </tr>
        </tbody>
      </table>

      <h2 className="section-title">Source</h2>
      <CodeBlock code={buildCode(recipe)} />

      <p className="detail-desc">
        The module needs only the <strong>three</strong> package — see{" "}
        <a href="#/installation">Installation</a> for dropping recipes into your
        own project.
      </p>

      <nav className="pn-nav">
        {prev ? (
          <button className="pn-link" onClick={() => navigate(`/recipe/${prev.slug}`)}>
            <small>Previous</small>
            {prev.title}
          </button>
        ) : (
          <span />
        )}
        {next ? (
          <button className="pn-link next" onClick={() => navigate(`/recipe/${next.slug}`)}>
            <small>Next</small>
            {next.title}
          </button>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}

function formatValue(value: number | undefined, step: number): string {
  if (value === undefined) return "—";
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return value.toFixed(decimals);
}
