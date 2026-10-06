import type { ImportedVSCodeTheme, SyntaxColor, ThemeMode } from './vscodeTheme';

export const APPEARANCE_STORAGE_KEY = 'kira.appearance.v1';

export interface AppearancePreferences {
  version: 1;
  themes: ImportedVSCodeTheme[];
  lightThemeId: string | null;
  darkThemeId: string | null;
}

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  version: 1,
  themes: [],
  lightThemeId: null,
  darkThemeId: null,
};

const SYNTAX_COLORS: readonly SyntaxColor[] = [
  'keyword',
  'string',
  'comment',
  'number',
  'function',
  'type',
  'variable',
  'operator',
  'constant',
  'tag',
  'attribute',
  'property',
  'punctuation',
  'background',
];
const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu;

function importedThemeIn(value: unknown): ImportedVSCodeTheme | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const item = value as Partial<ImportedVSCodeTheme>;
  if (
    typeof item.id !== 'string' ||
    item.id.length > 180 ||
    typeof item.name !== 'string' ||
    item.name.length > 160 ||
    (item.variant !== 'light' && item.variant !== 'dark') ||
    (item.author !== undefined && (typeof item.author !== 'string' || item.author.length > 160)) ||
    typeof item.tokens !== 'object' ||
    item.tokens === null ||
    Array.isArray(item.tokens) ||
    typeof item.syntax !== 'object' ||
    item.syntax === null ||
    Array.isArray(item.syntax)
  )
    return null;

  const tokens = Object.entries(item.tokens);
  if (
    tokens.length > 48 ||
    tokens.some(
      ([key, color]) =>
        !/^--color-[a-z-]+$/u.test(key) || typeof color !== 'string' || !HEX_COLOR.test(color),
    )
  )
    return null;
  const syntax = Object.entries(item.syntax);
  if (
    syntax.length > SYNTAX_COLORS.length ||
    syntax.some(
      ([key, color]) =>
        !SYNTAX_COLORS.includes(key as SyntaxColor) ||
        typeof color !== 'string' ||
        !HEX_COLOR.test(color),
    )
  )
    return null;

  return item as ImportedVSCodeTheme;
}

export function appearancePreferencesIn(value: unknown): AppearancePreferences {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return DEFAULT_APPEARANCE;
  const candidate = value as Partial<AppearancePreferences>;
  if (candidate.version !== 1 || !Array.isArray(candidate.themes)) return DEFAULT_APPEARANCE;

  const themes = candidate.themes
    .slice(0, 40)
    .map(importedThemeIn)
    .filter((theme): theme is ImportedVSCodeTheme => theme !== null);
  const has = (id: unknown, mode: ThemeMode): id is string =>
    typeof id === 'string' && themes.some((theme) => theme.id === id && theme.variant === mode);

  return {
    version: 1,
    themes,
    lightThemeId: has(candidate.lightThemeId, 'light') ? candidate.lightThemeId : null,
    darkThemeId: has(candidate.darkThemeId, 'dark') ? candidate.darkThemeId : null,
  };
}

export function readAppearancePreferences(
  storage: Pick<Storage, 'getItem'>,
): AppearancePreferences {
  try {
    const stored = storage.getItem(APPEARANCE_STORAGE_KEY);
    return stored === null ? DEFAULT_APPEARANCE : appearancePreferencesIn(JSON.parse(stored));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function chooseAppearanceTheme(
  preferences: AppearancePreferences,
  mode: ThemeMode,
  id: string | null,
): AppearancePreferences {
  if (id !== null && !preferences.themes.some((theme) => theme.id === id && theme.variant === mode))
    return preferences;
  return mode === 'light'
    ? { ...preferences, lightThemeId: id }
    : { ...preferences, darkThemeId: id };
}

export function addAppearanceTheme(
  preferences: AppearancePreferences,
  imported: ImportedVSCodeTheme,
): AppearancePreferences {
  const themes = [
    ...preferences.themes.filter((theme) => theme.id !== imported.id),
    imported,
  ].slice(-40);
  const withTheme = { ...preferences, themes };
  return chooseAppearanceTheme(withTheme, imported.variant, imported.id);
}

export function removeAppearanceTheme(
  preferences: AppearancePreferences,
  id: string,
): AppearancePreferences {
  return {
    ...preferences,
    themes: preferences.themes.filter((theme) => theme.id !== id),
    lightThemeId: preferences.lightThemeId === id ? null : preferences.lightThemeId,
    darkThemeId: preferences.darkThemeId === id ? null : preferences.darkThemeId,
  };
}

export function writeAppearancePreferences(
  storage: Pick<Storage, 'setItem'>,
  preferences: AppearancePreferences,
): void {
  storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preferences));
}
