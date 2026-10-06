import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addAppearanceTheme,
  chooseAppearanceTheme,
  DEFAULT_APPEARANCE,
  readAppearancePreferences,
  writeAppearancePreferences,
} from '@kira/theme/appearancePreferences';
import { parseVSCodeJson } from '@kira/theme/vscodeJson';
import { importVSCodeTheme } from '@kira/theme/vscodeTheme';

for (const scenario of [
  {
    name: 'removes comments and trailing commas',
    source: '{/* comment */"items":[1,2,],}',
    expected: { items: [1, 2] },
  },
  {
    name: 'preserves comment markers and trailing-comma-like text inside strings',
    source: '{"text":"// keep /* this */, }"}',
    expected: { text: '// keep /* this */, }' },
  },
]) {
  test(`parses JSONC and ${scenario.name}`, () => {
    assert.deepEqual(parseVSCodeJson(scenario.source), scenario.expected);
  });
}

test('imports VS Code UI colors and general syntax colors into a mode-specific Kira theme', () => {
  const imported = importVSCodeTheme(
    `{
      // VS Code accepts JSONC theme files.
      "name": "Copper Night",
      "type": "dark",
      "colors": {
        "editor.background": "#121212",
        "editor.foreground": "#eeeeee",
        "button.background": "#bc6030",
        "sideBar.background": "#191919",
        "focusBorder": "#d8895c"
      },
      "tokenColors": [
        { "scope": "keyword.control", "settings": { "foreground": "#ed9e43" } },
        { "scope": "string", "settings": { "foreground": "#8fc17a" } }
      ],
    }`,
    'copper-night-color-theme.json',
  );

  assert.equal(imported.name, 'Copper Night');
  assert.equal(imported.variant, 'dark');
  assert.equal(imported.tokens['--color-background-surface'], '#121212');
  assert.equal(imported.tokens['--color-background-body'], '#191919');
  assert.equal(imported.tokens['--color-accent'], '#bc6030');
  assert.equal(imported.tokens['--color-accent-muted'], '#bc603080');
  assert.equal(imported.syntax.keyword, '#ed9e43');
  assert.equal(imported.syntax.string, '#8fc17a');
});

test('refuses a VS Code theme without an editor background', () => {
  assert.throws(
    () => importVSCodeTheme('{"colors":{"editor.foreground":"#eeeeee"}}', 'no-background.json'),
    /editor\.background/u,
  );
});

test('rejects malformed token rules instead of failing while applying the theme', () => {
  assert.throws(
    () =>
      importVSCodeTheme('{"colors":{"editor.background":"#fff"},"tokenColors":[null]}', 'bad.json'),
    /supported VS Code color theme/u,
  );
});

test('an imported theme is selected for its variant and survives local persistence', () => {
  const imported = importVSCodeTheme(
    '{"name":"Paper","type":"light","colors":{"editor.background":"#fdfcfa"}}',
    'paper.json',
  );
  const selected = addAppearanceTheme(DEFAULT_APPEARANCE, imported);
  const storage = new Map<string, string>();
  writeAppearancePreferences({ setItem: (key, value) => storage.set(key, value) }, selected);
  const restored = readAppearancePreferences({ getItem: (key) => storage.get(key) ?? null });

  assert.equal(restored.lightThemeId, imported.id);
  assert.equal(restored.darkThemeId, null);
  assert.deepEqual(restored.themes, [imported]);
});

test('only a theme matching the chosen light or dark mode can be selected', () => {
  const imported = importVSCodeTheme(
    '{"name":"Paper","type":"light","colors":{"editor.background":"#fdfcfa"}}',
    'paper.json',
  );
  const preferences = addAppearanceTheme(DEFAULT_APPEARANCE, imported);

  assert.equal(chooseAppearanceTheme(preferences, 'dark', imported.id), preferences);
  assert.deepEqual(chooseAppearanceTheme(preferences, 'light', null), {
    ...preferences,
    lightThemeId: null,
  });
});
