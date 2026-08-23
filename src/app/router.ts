import { useEffect, useState } from "react";

export type Route =
  | { kind: "browse" }
  | { kind: "recipe"; slug: string }
  | { kind: "installation" }
  | { kind: "about" }
  | { kind: "notfound"; path: string };

export function parseHash(hash: string): Route {
  let path = hash.replace(/^#/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    return { kind: "notfound", path };
  }
  path = path.replace(/\/+$/, "");
  if (path === "" || path === "/" || path === "/browse") return { kind: "browse" };
  if (path === "/installation") return { kind: "installation" };
  if (path === "/about") return { kind: "about" };
  const recipe = path.match(/^\/recipe\/([a-z0-9-]+)$/);
  if (recipe) return { kind: "recipe", slug: recipe[1] };
  return { kind: "notfound", path };
}

export function navigate(to: string): void {
  window.location.hash = to;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}
