import { useMemo, useState } from "react";
import { categories, recipes } from "../recipes";
import { RecipeCard } from "../components/RecipeCard";
import type { CategoryId } from "../engine/types";

export function BrowsePage() {
  const [category, setCategory] = useState<CategoryId | "all">("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((recipe) => {
      if (category !== "all" && recipe.category !== category) return false;
      if (!q) return true;
      const haystack = [recipe.title, recipe.category, ...recipe.tags]
        .join(" ")
        .toLowerCase();
      return q.split(/\s+/).every((word) => haystack.includes(word));
    });
  }, [category, query]);

  return (
    <div>
      <header className="page-head">
        <span className="eyebrow">Three.js Cookbook</span>
        <h1>Interactive Three.js recipes, ready to copy</h1>
        <p>
          Small, self-contained WebGL studies — geometry, particles, shaders,
          lighting, and motion. Every recipe has live props, variants, and
          dependency-free source you can paste into any project.
        </p>
      </header>

      <div className="browse-controls">
        <div className="pill-row" role="group" aria-label="Filter recipes by category">
          <button
            className={`pill${category === "all" ? " active" : ""}`}
            onClick={() => setCategory("all")}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`pill${category === c.id ? " active" : ""}`}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <input
          className="grid-search"
          value={query}
          placeholder={`Search ${recipes.length} recipes`}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {visible.length === 0 ? (
        <div className="empty-state">
          No recipes match "{query}"{category !== "all" ? " in this category" : ""}.
        </div>
      ) : (
        <div className="card-grid">
          {visible.map((recipe) => (
            <RecipeCard key={recipe.slug} recipe={recipe} />
          ))}
        </div>
      )}
    </div>
  );
}
