import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import manifest from 'material-icon-theme/dist/material-icons.json' with { type: 'json' };
import { type IconKind, type IconScheme, iconFileFor, iconNameFor } from './fileIcons.ts';

interface Case {
  /** What the test is called. */
  name: string;
  /** The row's name, as the tree labels it: the last segment of its path. */
  row: string;
  kind: IconKind;
  scheme: IconScheme;
  /** The name the theme gives that row's icon. */
  want: string;
}

/**
 * The theme's own answers, read out of its manifest rather than invented here.
 *
 * These are the cases that decide the lookup's order: a name beats an extension,
 * the longest extension the theme knows beats a shorter one, a name the theme
 * does not know gets the plain file, and a light override applies to the names it
 * covers and to nothing else.
 */
const CASES: Case[] = [
  {
    name: 'a name the theme knows beats the extension it also knows',
    row: 'package.json',
    kind: 'file',
    scheme: 'dark',
    want: 'nodejs',
  },
  {
    name: 'a readme is the readme icon rather than markdown',
    row: 'README.md',
    kind: 'file',
    scheme: 'dark',
    want: 'readme',
  },
  {
    name: 'a config file the theme knows beats the config extension',
    row: 'vite.config.ts',
    kind: 'file',
    scheme: 'dark',
    want: 'vite',
  },
  {
    name: 'a named config is not the plain config icon',
    row: 'tsconfig.json',
    kind: 'file',
    scheme: 'dark',
    want: 'tsconfig',
  },
  {
    name: 'the longest extension the theme knows wins',
    row: 'watching.test.ts',
    kind: 'file',
    scheme: 'dark',
    want: 'test-ts',
  },
  {
    name: 'an extension the theme knows',
    row: 'main.ts',
    kind: 'file',
    scheme: 'dark',
    want: 'typescript',
  },
  {
    name: 'a component is the react icon for a ts file',
    row: 'App.tsx',
    kind: 'file',
    scheme: 'dark',
    want: 'react_ts',
  },
  {
    name: 'a name the theme keys in lower case still matches',
    row: 'Dockerfile',
    kind: 'file',
    scheme: 'dark',
    want: 'docker',
  },
  {
    name: 'a dotfile the theme knows',
    row: '.gitignore',
    kind: 'file',
    scheme: 'dark',
    want: 'git',
  },
  {
    name: 'a dotless name the theme knows',
    row: 'Makefile',
    kind: 'file',
    scheme: 'dark',
    want: 'makefile',
  },
  {
    name: 'a binary by its extension',
    row: 'photo.png',
    kind: 'file',
    scheme: 'dark',
    want: 'image',
  },
  {
    name: 'a database by its extension',
    row: 'data.sqlite',
    kind: 'file',
    scheme: 'dark',
    want: 'database',
  },
  {
    name: 'a name with no extension at all',
    row: 'no-extension',
    kind: 'file',
    scheme: 'dark',
    want: 'file',
  },
  {
    name: 'an extension the theme does not know',
    row: 'weird.qqq',
    kind: 'file',
    scheme: 'dark',
    want: 'file',
  },
  {
    name: 'a file named after something every object has',
    row: 'constructor',
    kind: 'file',
    scheme: 'dark',
    want: 'file',
  },
  {
    name: 'an extension named after something every object has',
    row: 'notes.valueOf',
    kind: 'file',
    scheme: 'dark',
    want: 'file',
  },
  {
    name: 'a folder named after something every object has',
    row: 'toString',
    kind: 'folder',
    scheme: 'dark',
    want: 'folder',
  },
  {
    name: 'a folder the theme knows',
    row: 'src',
    kind: 'folder',
    scheme: 'dark',
    want: 'folder-src',
  },
  {
    name: 'an ignored folder the theme knows',
    row: 'node_modules',
    kind: 'folder',
    scheme: 'dark',
    want: 'folder-node',
  },
  {
    name: 'a folder the theme knows by name',
    row: 'apps',
    kind: 'folder',
    scheme: 'dark',
    want: 'folder-app',
  },
  {
    name: 'a folder whose name means nothing to the theme',
    row: 'whatever',
    kind: 'folder',
    scheme: 'dark',
    want: 'folder',
  },
  {
    name: 'a light override leaves a name it does not cover alone',
    row: 'main.ts',
    kind: 'file',
    scheme: 'light',
    want: 'typescript',
  },
  {
    name: 'a lock file draws differently in the dark',
    row: 'bun.lock',
    kind: 'file',
    scheme: 'dark',
    want: 'bun',
  },
  {
    name: 'a lock file draws differently in the light',
    row: 'bun.lock',
    kind: 'file',
    scheme: 'light',
    want: 'bun_light',
  },
  {
    name: 'a light extension override',
    row: 'Cargo.toml',
    kind: 'file',
    scheme: 'dark',
    want: 'toml',
  },
  {
    name: 'the same extension in the light',
    row: 'Cargo.toml',
    kind: 'file',
    scheme: 'light',
    want: 'toml_light',
  },
  {
    name: 'a light folder override',
    row: 'jinja',
    kind: 'folder',
    scheme: 'light',
    want: 'folder-jinja_light',
  },
  {
    name: 'a folder the light does not cover',
    row: 'whatever',
    kind: 'folder',
    scheme: 'light',
    want: 'folder',
  },
  {
    name: 'a file the theme does not know, drawn light',
    row: 'weird.qqq',
    kind: 'file',
    scheme: 'light',
    want: 'file',
  },
];

for (const testCase of CASES) {
  test(testCase.name, () => {
    assert.equal(iconNameFor(testCase.row, testCase.kind, testCase.scheme), testCase.want);
  });
}

/**
 * Every name the theme knows is one it defines, and one it ships a file for.
 *
 * The theme's tables and its definitions are two different lists, and a lookup
 * that answered with a name nothing defines would draw an empty row rather than a
 * wrong one — which is the failure that would not look like one. Extensions are
 * asked as extensions, so that path is exercised rather than falling through to
 * the plain file icon, and each table is asked both ways round: in the dark, and in
 * the light, where a miss has to fall back to the theme's own answer rather than to
 * its plain file icon.
 */
test('every name the theme knows is one it defines', () => {
  const tables: [IconKind, boolean, Record<string, string>][] = [
    ['file', false, manifest.fileNames],
    ['file', true, manifest.fileExtensions],
    ['folder', false, manifest.folderNames],
    ['file', false, manifest.light.fileNames],
    ['file', true, manifest.light.fileExtensions],
    ['folder', false, manifest.light.folderNames],
  ];

  for (const [kind, isExtension, table] of tables) {
    for (const key of Object.keys(table)) {
      const row = isExtension ? `x.${key}` : key;
      for (const scheme of ['dark', 'light'] as IconScheme[]) {
        const name = iconNameFor(row, kind, scheme);
        assert.ok(
          manifest.iconDefinitions[name] !== undefined,
          `"${row}" answered "${name}", which the theme does not define`,
        );
        assert.ok(
          iconFileFor(name)?.endsWith('.svg') === true,
          `"${row}" answered "${name}", which the theme names no file for`,
        );
      }
    }
  }
});
