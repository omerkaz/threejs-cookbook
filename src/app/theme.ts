import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type Scheme = "light" | "dark";
export type PaletteId = "mono" | "sepia" | "azure" | "moss" | "mauve";

export const PALETTES: PaletteId[] = ["mono", "sepia", "azure", "moss", "mauve"];

export const PALETTE_LABELS: Record<PaletteId, string> = {
  mono: "Monotone",
  sepia: "Sepia",
  azure: "Azure",
  moss: "Moss",
  mauve: "Mauve",
};

export interface ThemeState {
  mode: ThemeMode;
  light: PaletteId;
  dark: PaletteId;
}

const KEYS = { mode: "tjc-theme", light: "tjc-palette-light", dark: "tjc-palette-dark" };

function isPalette(value: string | null): value is PaletteId {
  return value !== null && (PALETTES as string[]).includes(value);
}

function load(): ThemeState {
  try {
    const mode = localStorage.getItem(KEYS.mode);
    const light = localStorage.getItem(KEYS.light);
    const dark = localStorage.getItem(KEYS.dark);
    return {
      mode: mode === "light" || mode === "system" ? mode : "dark",
      light: isPalette(light) ? light : "mono",
      dark: isPalette(dark) ? dark : "mono",
    };
  } catch {
    return { mode: "dark", light: "mono", dark: "mono" };
  }
}

function save(state: ThemeState): void {
  try {
    localStorage.setItem(KEYS.mode, state.mode);
    localStorage.setItem(KEYS.light, state.light);
    localStorage.setItem(KEYS.dark, state.dark);
  } catch {
    // Storage unavailable (private mode etc.) — theme still applies in-memory.
  }
}

export function resolveScheme(state: ThemeState): Scheme {
  if (state.mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return state.mode;
}

function apply(state: ThemeState): void {
  const root = document.documentElement;
  if (state.mode === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = state.mode;
  const scheme = resolveScheme(state);
  root.dataset.scheme = scheme;
  root.dataset.palette = scheme === "dark" ? state.dark : state.light;
}

export interface ThemeApi {
  state: ThemeState;
  scheme: Scheme;
  setMode(mode: ThemeMode): void;
  /** Cycle the active scheme's palette (used when re-clicking the active mode). */
  cyclePalette(): void;
}

export function useTheme(): ThemeApi {
  const [state, setState] = useState<ThemeState>(load);

  useEffect(() => {
    apply(state);
    save(state);
  }, [state]);

  // Follow OS appearance while in system mode.
  useEffect(() => {
    if (state.mode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply(state);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [state]);

  const setMode = useCallback((mode: ThemeMode) => {
    setState((prev) => ({ ...prev, mode }));
  }, []);

  const cyclePalette = useCallback(() => {
    setState((prev) => {
      const scheme = resolveScheme(prev);
      const current = scheme === "dark" ? prev.dark : prev.light;
      const next = PALETTES[(PALETTES.indexOf(current) + 1) % PALETTES.length];
      return scheme === "dark" ? { ...prev, dark: next } : { ...prev, light: next };
    });
  }, []);

  return { state, scheme: resolveScheme(state), setMode, cyclePalette };
}
