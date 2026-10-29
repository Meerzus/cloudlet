import { describe, expect, it } from 'vitest';
import {
  parsePreference,
  resolveTheme,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '../../apps/site/src/lib/theme';

/** Runs the pre-hydration script against a minimal fake document. */
function runInitScript(stored: string | null, systemDark: boolean, storageThrows = false) {
  const classes = new Set<string>();
  const root = {
    classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
  };
  const localStorage = {
    getItem: (key: string) => {
      if (storageThrows) throw new Error('blocked');
      return key === THEME_STORAGE_KEY ? stored : null;
    },
  };
  const matchMedia = (query: string) => ({ matches: query === '(prefers-color-scheme: dark)' && systemDark });
  new Function('document', 'localStorage', 'matchMedia', THEME_INIT_SCRIPT)({ documentElement: root }, localStorage, matchMedia);
  return { dark: classes.has('dark'), preference: root.dataset['theme'], scheme: root.style['colorScheme'] };
}

describe('site theme', () => {
  it('parses only known explicit preferences', () => {
    expect(parsePreference('dark')).toBe('dark');
    expect(parsePreference('light')).toBe('light');
    expect(parsePreference('sepia')).toBe('system');
    expect(parsePreference(null)).toBe('system');
  });

  it.each<[string | null, boolean]>([
    [null, false],
    [null, true],
    ['light', true],
    ['dark', false],
    ['garbage', true],
  ])('init script matches resolveTheme for stored=%s, systemDark=%s', (stored, systemDark) => {
    const preference: ThemePreference = parsePreference(stored);
    const resolved = resolveTheme(preference, systemDark);
    expect(runInitScript(stored, systemDark)).toEqual({
      dark: resolved === 'dark',
      preference,
      scheme: resolved,
    });
  });

  it('init script never throws when storage is blocked', () => {
    expect(() => runInitScript(null, true, true)).not.toThrow();
  });
});
