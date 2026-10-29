'use client';

import { useSyncExternalStore } from 'react';
import {
  getThemeSnapshot,
  SERVER_THEME_SNAPSHOT,
  setThemePreference,
  subscribeTheme,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme';

export function useTheme() {
  const value = useSyncExternalStore(subscribeTheme, getThemeSnapshot, () => SERVER_THEME_SNAPSHOT);
  const [preference, resolved] = value.split(':') as [ThemePreference, ResolvedTheme];
  return { preference, resolved, setPreference: setThemePreference };
}
