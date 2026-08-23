import { useState } from "react";
import { categories, recipesByCategory } from "../recipes";
import { navigate, type Route } from "../app/router";
import { PALETTE_LABELS, type ThemeApi, type ThemeMode } from "../app/theme";

const REPO_URL = "https://github.com/omerkaz/threejs-cookbook";

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface SidebarProps {
  route: Route;
  theme: ThemeApi;
  open: boolean;
  onOpenSearch(): void;
}

export function Sidebar({ route, theme, open, onOpenSearch }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const activeSlug = route.kind === "recipe" ? route.slug : null;

  const modes: Array<{ id: ThemeMode; label: string }> = [
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
    { id: "system", label: "System" },
  ];

  const activePalette =
    theme.scheme === "dark" ? theme.state.dark : theme.state.light;

  function onModeClick(mode: ThemeMode): void {
    if (theme.state.mode === mode && mode !== "system") theme.cyclePalette();
    else theme.setMode(mode);
  }

  return (
    <aside className={`sidebar${open ? " open" : ""}`}>
      <div className="sidebar-top">
        <div className="brand-row">
          <button className="brand" onClick={() => navigate("/browse")} aria-label="Browse Three.js Cookbook">
            <img src="./cookbook-mark.svg" alt="" />
            <span>cookbook</span>
          </button>
          <a
            className="gh-badge"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View threejs-cookbook on GitHub"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            <span>Repo</span>
          </a>
        </div>
        <button className="search-trigger" onClick={onOpenSearch}>
          <span>Search...</span>
          <kbd>⌘ K</kbd>
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="Cookbook navigation">
        <div className="nav-section">
          <h2 className="nav-heading">Documentation</h2>
          <button
            className={`nav-item${route.kind === "browse" ? " active" : ""}`}
            onClick={() => navigate("/browse")}
          >
            Browse
          </button>
          <button
            className={`nav-item${route.kind === "installation" ? " active" : ""}`}
            onClick={() => navigate("/installation")}
          >
            Installation
          </button>
          <button
            className={`nav-item${route.kind === "about" ? " active" : ""}`}
            onClick={() => navigate("/about")}
          >
            About
          </button>
        </div>

        <div className="nav-section">
          <h2 className="nav-heading">Recipes</h2>
          {categories.map((category) => {
            const items = recipesByCategory(category.id);
            if (items.length === 0) return null;
            const isCollapsed = collapsed[category.id] ?? false;
            return (
              <div className="tree-group" key={category.id}>
                <button
                  className={`tree-head${isCollapsed ? " closed" : ""}`}
                  aria-expanded={!isCollapsed}
                  onClick={() =>
                    setCollapsed((prev) => ({ ...prev, [category.id]: !isCollapsed }))
                  }
                >
                  <span>{category.label}</span>
                  <Chevron />
                </button>
                {!isCollapsed && (
                  <div className="tree-children">
                    {items.map((recipe) => (
                      <button
                        key={recipe.slug}
                        className={`tree-item${activeSlug === recipe.slug ? " active" : ""}`}
                        onClick={() => navigate(`/recipe/${recipe.slug}`)}
                      >
                        <span>{recipe.title}</span>
                        {recipe.variants.length > 1 && (
                          <span className="badge" aria-label={`${recipe.variants.length} variants`}>
                            {recipe.variants.length}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      <div className="sidebar-foot">
        <div className="theme-switch" role="group" aria-label="Appearance">
          {modes.map((mode) => (
            <button
              key={mode.id}
              className={theme.state.mode === mode.id ? "active" : ""}
              aria-pressed={theme.state.mode === mode.id}
              title={
                theme.state.mode === mode.id && mode.id !== "system"
                  ? `${mode.label} mode, ${PALETTE_LABELS[activePalette]}. Click to cycle palette`
                  : `Use ${mode.label.toLowerCase()} mode`
              }
              onClick={() => onModeClick(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <p className="palette-hint">
          palette: {PALETTE_LABELS[activePalette].toLowerCase()} — click active mode to cycle
        </p>
      </div>
    </aside>
  );
}
