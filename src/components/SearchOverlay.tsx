import { useEffect, useMemo, useRef, useState } from "react";
import { categoryLabel, recipes } from "../recipes";
import { navigate } from "../app/router";
import type { RecipeDef } from "../engine/types";

function matches(recipe: RecipeDef, query: string): boolean {
  const haystack = [
    recipe.title,
    recipe.category,
    categoryLabel(recipe.category),
    ...recipe.tags,
    ...recipe.variants.map((v) => v.label),
  ]
    .join(" ")
    .toLowerCase();
  return query.split(/\s+/).every((word) => haystack.includes(word));
}

export function SearchOverlay({ onClose }: { onClose(): void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter((recipe) => matches(recipe, q));
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  function open(slug: string): void {
    onClose();
    navigate(`/recipe/${slug}`);
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((s) => Math.min(s + 1, hits.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (event.key === "Enter" && hits[selected]) {
      event.preventDefault();
      open(hits[selected].slug);
    }
  }

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="search-panel" role="dialog" aria-label="Search recipes" onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          value={query}
          placeholder={`Search ${recipes.length} recipes...`}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="search-results">
          {hits.length === 0 && <div className="search-empty">No recipes match "{query}"</div>}
          {hits.map((recipe, index) => (
            <button
              key={recipe.slug}
              className={`search-hit${index === selected ? " selected" : ""}`}
              onMouseEnter={() => setSelected(index)}
              onClick={() => open(recipe.slug)}
            >
              <span>{recipe.title}</span>
              <small>{categoryLabel(recipe.category)}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
