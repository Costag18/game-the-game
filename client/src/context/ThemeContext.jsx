import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const ThemeContext = createContext(null);

const STORAGE_KEY = 'gtg_theme';

export const THEMES = [
  { id: 'classic', name: 'Classic', swatch: '#6b1c1c' },
  { id: 'royal-blue', name: 'Royal Blue', swatch: '#1c2c6b' },
  { id: 'emerald', name: 'Emerald', swatch: '#1c6b2c' },
  { id: 'midnight', name: 'Midnight', swatch: '#3c1c6b' },
  { id: 'noir', name: 'Noir', swatch: '#222222' },
  { id: 'ivory', name: 'Ivory', swatch: '#ece5d5' },
];

function applyTheme(id) {
  if (!id || id === 'classic') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = id;
  }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && THEMES.some((t) => t.id === saved)) return saved;
    } catch { /* ignore */ }
    return 'classic';
  });

  // Apply on mount
  useEffect(() => { applyTheme(theme); }, []);

  const setTheme = useCallback((id) => {
    setThemeState(id);
    applyTheme(id);
    try { localStorage.setItem(STORAGE_KEY, id); }
    catch { /* ignore */ }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be inside ThemeProvider');
  return ctx;
}
