import manifest from 'material-icon-theme/dist/material-icons.json' with { type: 'json' };

/** Which way the app is drawing. The theme has a few icons for each. */
export type IconScheme = 'light' | 'dark';

/** What a row is. The theme keeps one vocabulary for files and one for folders. */
export type IconKind = 'file' | 'folder';

/** One of the theme's lookup tables: names, extensions or folder names. */
type IconTable = Record<string, string>;

/**
 * The theme's name for the icon that stands for one row of the tree.
 *
 * The name is asked before the extension, because the name is the more specific
 * fact: `package.json` is the npm icon rather than the JSON one, and
 * `watching.test.ts` is a test rather than TypeScript. Extensions are asked from
 * the longest suffix down, which is what makes the theme's own multi-part entries
 * — `test.ts`, `d.ts` — reachable at all.
 */
export function iconNameFor(name: string, kind: IconKind, scheme: IconScheme): string {
  const overrides = scheme === 'light' ? manifest.light : undefined;

  if (kind === 'folder') {
    return inTheme(manifest.folderNames, overrides?.folderNames, name) ?? manifest.folder;
  }

  const named = inTheme(manifest.fileNames, overrides?.fileNames, name);
  if (named !== undefined) return named;

  const parts = name.split('.');
  for (let i = 1; i < parts.length; i += 1) {
    const suffix = parts.slice(i).join('.');
    const hit = inTheme(manifest.fileExtensions, overrides?.fileExtensions, suffix);
    if (hit !== undefined) return hit;
  }

  return manifest.file;
}

/**
 * The theme's own file for one of its icon names.
 *
 * The manifest points at its icons from its own directory, and what is wanted
 * here is the file's name: the icons are what the renderer bundles, by name.
 */
export function iconFileFor(name: string): string | undefined {
  return manifest.iconDefinitions[name]?.iconPath.split('/').pop();
}

/**
 * One key, asked of the theme's light table and then of its own.
 *
 * The light tables are overrides rather than a second vocabulary, so a miss in
 * them falls back to the theme's normal answer and never to its plain file icon.
 */
function inTheme(
  plain: IconTable,
  overrides: IconTable | undefined,
  key: string,
): string | undefined {
  return (overrides === undefined ? undefined : inTable(overrides, key)) ?? inTable(plain, key);
}

/**
 * A table asked for the key as written and then folded down.
 *
 * The tables are keyed in lower case with a handful of exceptions — `PKGBUILD`,
 * `XamlStyler.json` — so both are worth asking. A key that is not the table's own
 * property is not its answer: `constructor` and `__proto__` are on every object
 * and are not icons, and a file really can be named `constructor`.
 */
function inTable(table: IconTable, key: string): string | undefined {
  if (Object.hasOwn(table, key)) return table[key];

  const folded = key.toLowerCase();
  return folded !== key && Object.hasOwn(table, folded) ? table[folded] : undefined;
}
