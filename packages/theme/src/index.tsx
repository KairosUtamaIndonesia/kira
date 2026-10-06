import { Theme, useTheme } from '@astryxdesign/core/theme';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  addAppearanceTheme,
  APPEARANCE_STORAGE_KEY,
  chooseAppearanceTheme,
  DEFAULT_APPEARANCE,
  readAppearancePreferences,
  removeAppearanceTheme,
  type AppearancePreferences,
} from './appearancePreferences';
import { kiraThemeFromVSCode, selectedVSCodeTheme } from './kiraThemeFromVSCode';
import type { ImportedVSCodeTheme, ThemeMode } from './vscodeTheme';
import './theme.css';

interface KiraAppearanceContextValue {
  preferences: AppearancePreferences;
  chooseTheme(mode: ThemeMode, id: string | null): void;
  importTheme(theme: ImportedVSCodeTheme): void;
  removeTheme(id: string): void;
}

const KiraAppearanceContext = createContext<KiraAppearanceContextValue | null>(null);

function initialAppearance(): AppearancePreferences {
  try {
    return typeof window === 'undefined'
      ? DEFAULT_APPEARANCE
      : readAppearancePreferences(window.localStorage);
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/**
 * Kira's theme, applied once so every surface is themed the same way.
 *
 * The CSS comes with this import rather than being asked for separately: a
 * consumer that took the provider without the rules would draw Kira's
 * components in Astryx's default type, and nothing would say so. What is left for
 * a consumer is its own layout, which is structure rather than looks.
 *
 * Astryx's components are styled by call site, so this shares the palette and the
 * typefaces and not the arrangement. Two surfaces reading as one product also
 * needs them built from the same components.
 */
export function KiraTheme({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(initialAppearance);
  const light = selectedVSCodeTheme(preferences.themes, preferences.lightThemeId);
  const dark = selectedVSCodeTheme(preferences.themes, preferences.darkThemeId);
  const theme = useMemo(() => kiraThemeFromVSCode(light, dark), [light, dark]);

  function updatePreferences(
    change: (current: AppearancePreferences) => AppearancePreferences,
  ): void {
    const next = change(preferences);
    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Keep the choice for this run if local storage is unavailable.
    }
    setPreferences(next);
  }

  const appearance: KiraAppearanceContextValue = {
    preferences,
    chooseTheme: (mode, id) =>
      updatePreferences((current) => chooseAppearanceTheme(current, mode, id)),
    importTheme: (imported) =>
      updatePreferences((current) => addAppearanceTheme(current, imported)),
    removeTheme: (id) => updatePreferences((current) => removeAppearanceTheme(current, id)),
  };

  return (
    <Theme theme={theme}>
      <KiraAppearanceContext.Provider value={appearance}>{children}</KiraAppearanceContext.Provider>
    </Theme>
  );
}

export function useKiraAppearance() {
  const appearance = useContext(KiraAppearanceContext);
  const { mode, token } = useTheme();
  if (!appearance) throw new Error('useKiraAppearance must be used inside KiraTheme.');

  const activeId =
    mode === 'light' ? appearance.preferences.lightThemeId : appearance.preferences.darkThemeId;
  return {
    ...appearance,
    mode,
    token,
    activeTheme: selectedVSCodeTheme(appearance.preferences.themes, activeId),
  };
}

export { importVSCodeTheme } from './vscodeTheme';
export type { ImportedVSCodeTheme, ThemeMode } from './vscodeTheme';
