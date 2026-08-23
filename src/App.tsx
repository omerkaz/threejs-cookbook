import { useEffect, useState } from "react";
import { useRoute } from "./app/router";
import { useTheme } from "./app/theme";
import { Sidebar } from "./components/Sidebar";
import { SearchOverlay } from "./components/SearchOverlay";
import { BrowsePage } from "./pages/BrowsePage";
import { RecipePage } from "./pages/RecipePage";
import { InstallationPage } from "./pages/InstallationPage";
import { AboutPage } from "./pages/AboutPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export function App() {
  const route = useRoute();
  const theme = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Global ⌘K / Ctrl+K toggles search; Escape is handled by the overlay.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Close the mobile sidebar on navigation.
  useEffect(() => {
    setSidebarOpen(false);
  }, [route]);

  let page: JSX.Element;
  switch (route.kind) {
    case "browse":
      page = <BrowsePage />;
      break;
    case "recipe":
      page = <RecipePage slug={route.slug} />;
      break;
    case "installation":
      page = <InstallationPage />;
      break;
    case "about":
      page = <AboutPage />;
      break;
    case "notfound":
      page = <NotFoundPage path={route.path} />;
      break;
  }

  return (
    <div className="shell">
      <Sidebar
        route={route}
        theme={theme}
        open={sidebarOpen}
        onOpenSearch={() => setSearchOpen(true)}
      />
      <main className="main">
        <div className="mobile-bar">
          <button onClick={() => setSidebarOpen((open) => !open)}>Menu</button>
          <button onClick={() => setSearchOpen(true)}>Search</button>
        </div>
        {page}
      </main>
      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
