'use client';

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'simplitest-theme';

/**
 * Read whatever the inline script in <head> already applied to the document.
 * On SSR / first render this returns 'light' so markup matches; the effect
 * inside useTheme re-syncs to the real DOM state on mount.
 */
function readCurrent(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/**
 * Theme hook — exposes the current theme + a toggle.
 * Persists to localStorage so the choice survives reloads. The actual paint
 * is driven by `data-theme="dark"` on <html>; CSS vars in globals.css do the
 * rest. The inline script in layout.tsx sets this attribute before the first
 * paint, so there's no white-flash on dark-mode reloads.
 */
export function useTheme(): { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(readCurrent);

  useEffect(() => {
    // Sync state with whatever the inline script applied (covers SSR mismatch).
    setThemeState(readCurrent());
  }, []);

  const apply = useCallback((t: Theme) => {
    document.documentElement.setAttribute('data-theme', t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* localStorage may be blocked in privacy modes — skip persistence */
    }
    setThemeState(t);
  }, []);

  const toggle = useCallback(() => apply(theme === 'dark' ? 'light' : 'dark'), [apply, theme]);

  return { theme, toggle, setTheme: apply };
}

/**
 * The inline-head script: read localStorage and apply data-theme BEFORE first
 * paint to avoid a flash of the wrong theme. Inlined into <head> via dangerouslySetInnerHTML.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(!t){t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
