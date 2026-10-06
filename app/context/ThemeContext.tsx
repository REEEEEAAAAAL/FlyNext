"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** The three preferences the user can pick from the navigation bar. */
export type Theme = "light" | "dark" | "system";

/** The two themes the document can actually be painted in. */
export type ResolvedTheme = "light" | "dark";

/** localStorage key. Must stay in sync with the inline bootstrap in `layout.tsx`. */
export const THEME_STORAGE_KEY = "theme";

/**
 * Key holding the last resolved theme. The bootstrap script reads the
 * preference and needs the media query only for `system`, so this is purely a
 * fast path: it lets a resize-free reload skip the media query round trip.
 * It is a cache only, never the source of truth.
 */
export const RESOLVED_THEME_STORAGE_KEY = "theme-resolved";

const MEDIA_QUERY = "(prefers-color-scheme: dark)";

interface ThemeContextValue {
  /** The stored preference. Defaults to `system` until the client mounts. */
  theme: Theme;
  /** What `theme` resolves to right now. Safe to branch on after `mounted`. */
  resolvedTheme: ResolvedTheme;
  /**
   * False during the server render and the first client render. Anything that
   * would differ between the two must be hidden behind this flag, or React
   * reports a hydration mismatch.
   */
  mounted: boolean;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** `matchMedia` is absent in some test/SSR environments; assume light there. */
function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia(MEDIA_QUERY).matches ? "dark" : "light";
}

/** Read the stored preference, tolerating blocked storage. */
function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Private mode or a storage-blocked iframe: fall back to the OS preference.
  }
  return "system";
}

/**
 * Resolve a preference to a concrete theme.
 *
 * `system` is resolved live rather than snapshotted at selection time, so a
 * machine that flips to dark at sunset repaints open tabs.
 */
function resolve(theme: Theme): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme;
}

/**
 * Applies `.dark` to `<html>` and keeps it in sync with the stored preference.
 *
 * The class is also written by the inline bootstrap in `layout.tsx` before the
 * first paint; this provider only takes over afterwards. That split is what
 * removes the flash of the light theme on refresh without rendering the theme
 * on the server (which would guarantee a hydration mismatch).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const [mounted, setMounted] = useState(false);

  /** Paint the document for a given preference and remember the result. */
  const applyTheme = useCallback((next: Theme) => {
    const nextResolved = resolve(next);
    const root = document.documentElement;
    root.classList.toggle("dark", nextResolved === "dark");
    root.style.colorScheme = nextResolved;
    try {
      window.localStorage.setItem(RESOLVED_THEME_STORAGE_KEY, nextResolved);
    } catch {
      // Storage is optional; the class on <html> is the real state.
    }
    setResolvedTheme(nextResolved);
  }, []);

  // Adopt whatever the bootstrap script settled on, then keep applying changes.
  useEffect(() => {
    const stored = getStoredTheme();
    setThemeState(stored);
    applyTheme(stored);
    setMounted(true);
  }, [applyTheme]);

  // Follow the OS while the preference is `system`.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(MEDIA_QUERY);
    const onChange = () => {
      if (theme === "system") {
        applyTheme("system");
      }
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme, applyTheme]);

  // Follow another tab that changed the preference. `storage` only fires in the
  // tabs that did not make the change, which is exactly the set that needs it.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next: Theme =
        event.newValue === "light" ||
        event.newValue === "dark" ||
        event.newValue === "system"
          ? event.newValue
          : "system";
      setThemeState(next);
      applyTheme(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [applyTheme]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Not being able to persist the preference must not block applying it.
      }
      applyTheme(next);
    },
    [applyTheme]
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, mounted, setTheme }),
    [theme, resolvedTheme, mounted, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Access the theme. Throws when used outside `ThemeProvider` so a missing
 * provider surfaces immediately instead of silently rendering the wrong theme.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
