import {
  THEME_CATALOG_CHANNELS,
  type Result,
  type VSCodeThemeExtension,
  type VSCodeThemePackageItem,
} from '../../preload/bridge.ts';
import { createThemeCatalog } from '../themes/catalog.ts';
import { envelope } from './result.ts';

export { THEME_CATALOG_CHANNELS };

export interface ThemeCatalogHandlers {
  search(query: unknown): Promise<Result<VSCodeThemeExtension[]>>;
  readPackage(input: unknown): Promise<Result<VSCodeThemePackageItem[]>>;
}

function stringField(value: unknown, key: string, maxLength: number): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= maxLength
    ? candidate
    : null;
}

export function themeCatalogHandlers(catalog = createThemeCatalog()): ThemeCatalogHandlers {
  return {
    search: (value) => {
      if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 160) {
        return Promise.resolve({ ok: false, error: 'Enter a search term up to 160 characters.' });
      }
      return envelope(() => catalog.search(value));
    },
    readPackage: (value) => {
      const namespace = stringField(value, 'namespace', 160);
      const name = stringField(value, 'name', 160);
      const version = stringField(value, 'version', 80);
      const label = stringField(value, 'label', 160);
      if (!namespace || !name || !version || !label) {
        return Promise.resolve({ ok: false, error: 'Choose a valid VS Code theme package.' });
      }
      return envelope(() => catalog.readPackage({ namespace, name, version, label }));
    },
  };
}
