export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];
export const THEME_STORAGE_KEY = 'cloudlet-site-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function parsePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}

/**
 * Runs in <head> before first paint, so the page never flashes the wrong sky.
 * Kept in sync with `applyTheme` below; it must stay dependency-free ES5.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem('${THEME_STORAGE_KEY}');p=p==='light'||p==='dark'?p:'system';var d=p==='dark'||(p==='system'&&matchMedia('${DARK_QUERY}').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.dataset.theme=p;r.style.colorScheme=d?'dark':'light'}catch(e){}})()`;

function applyTheme(preference: ThemePreference, resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset['theme'] = preference;
  root.style.colorScheme = resolved;
}

function readPreference(): ThemePreference {
  try {
    return parsePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

/* A tiny external store: the DOM class is the source of truth for CSS, this mirrors it for React. */
const listeners = new Set<() => void>();
let snapshot: `${ThemePreference}:${ResolvedTheme}` | null = null;

function compute() {
  const preference = readPreference();
  const resolved = resolveTheme(preference, matchMedia(DARK_QUERY).matches);
  snapshot = `${preference}:${resolved}`;
  applyTheme(preference, resolved);
}

function notify() {
  compute();
  for (const listener of listeners) listener();
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    matchMedia(DARK_QUERY).addEventListener('change', notify);
    window.addEventListener('storage', notify);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      matchMedia(DARK_QUERY).removeEventListener('change', notify);
      window.removeEventListener('storage', notify);
    }
  };
}

export function getThemeSnapshot() {
  if (snapshot === null) compute();
  return snapshot as string;
}

export const SERVER_THEME_SNAPSHOT = 'system:light';

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* Storage can be unavailable (private mode); the choice still applies to this page. */
  }
  const resolved = resolveTheme(preference, matchMedia(DARK_QUERY).matches);
  snapshot = `${preference}:${resolved}`;
  applyTheme(preference, resolved);
  for (const listener of listeners) listener();
}
