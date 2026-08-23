import { navigate } from "../app/router";

export function NotFoundPage({ path }: { path: string }) {
  return (
    <div className="prose">
      <span className="eyebrow">404</span>
      <h1 style={{ letterSpacing: "-0.03em" }}>Nothing simmering here</h1>
      <p>
        The path <code>{path || "/"}</code> doesn't match any page or recipe.
      </p>
      <p>
        <button className="pill active" onClick={() => navigate("/browse")}>
          Back to Browse
        </button>
      </p>
    </div>
  );
}
