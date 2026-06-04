import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

// Suite-wide theme. Each app is its own Firebase origin, so localStorage is
// per-app — every app remembers its own preference under the same key. To kill
// the first-paint flash, apps also set data-theme from this key via a tiny
// inline script in index.html before React mounts (see applyThemeBeforePaint).
export const THEME_STORAGE_KEY = 'alma.theme';

export function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Shared theme state for the suite. Reads the persisted preference, applies
 * `data-theme` to <html>, and persists changes. Self-contained — a component
 * (e.g. ThemeToggle) can own the single instance per app; the rest of the app
 * just reads the CSS variables that re-theme off `[data-theme='dark']`.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* private mode — fine, just don't persist */
    }
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => setThemeState(mode), []);
  const toggleTheme = useCallback(
    () => setThemeState((current) => (current === 'dark' ? 'light' : 'dark')),
    []
  );

  return { theme, setTheme, toggleTheme };
}
