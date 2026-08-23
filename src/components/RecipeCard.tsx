import { useEffect, useState } from "react";
import { requestThumbnail } from "../engine/thumbs";
import { navigate } from "../app/router";
import type { RecipeDef } from "../engine/types";

export function RecipeCard({ recipe }: { recipe: RecipeDef }) {
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    requestThumbnail(recipe)
      .then((url) => {
        if (alive) setThumb(url);
      })
      .catch(() => {
        // WebGL unavailable — the dark placeholder stays, the page still works.
      });
    return () => {
      alive = false;
    };
  }, [recipe]);

  return (
    <button className="card" onClick={() => navigate(`/recipe/${recipe.slug}`)}>
      <span className="card-thumb">
        {thumb && <img className="ready" src={thumb} alt={`${recipe.title} preview`} />}
      </span>
      <span className="card-title">
        <span>{recipe.title}</span>
        {recipe.variants.length > 1 && (
          <span className="badge">{recipe.variants.length}</span>
        )}
      </span>
      <span className="card-tags">
        {recipe.tags.map((tag) => (
          <span className="tag" key={tag}>
            {tag}
          </span>
        ))}
      </span>
    </button>
  );
}
