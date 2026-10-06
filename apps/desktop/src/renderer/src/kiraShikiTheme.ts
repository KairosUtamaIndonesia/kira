import type { ThemeRegistration } from 'shiki';
import type { ThemeMode } from '@kira/theme';

const SYNTAX: ReadonlyArray<[string, string[]]> = [
  ['keyword', ['keyword', 'storage']],
  ['string', ['string']],
  ['comment', ['comment']],
  ['number', ['constant.numeric']],
  ['function', ['entity.name.function', 'support.function']],
  ['type', ['entity.name.type', 'support.type', 'support.class']],
  ['variable', ['variable', 'variable.other.readwrite']],
  ['operator', ['keyword.operator']],
  ['constant', ['constant.language', 'constant.other']],
  ['tag', ['entity.name.tag']],
  ['attribute', ['entity.other.attribute-name']],
  ['property', ['variable.other.property', 'support.type.property-name']],
  ['punctuation', ['punctuation']],
];

export type KiraShikiTheme = ThemeRegistration & { name: string };

/** A Shiki registration built from the same resolved tokens as Astryx. */
export function kiraShikiTheme(
  mode: ThemeMode,
  id: string | undefined,
  token: (name: string) => string,
): KiraShikiTheme {
  const name = `kira-${mode}-${(id ?? 'openchamber').replace(/[^a-z0-9-]/giu, '-')}`;
  const syntaxColor = (key: string) => token(`--color-syntax-${key}`);
  return {
    name,
    type: mode,
    colors: {
      'editor.background': syntaxColor('background'),
      'editor.foreground': token('--color-text-primary'),
      'editorLineNumber.foreground': token('--color-text-secondary'),
      'editorLineNumber.activeForeground': token('--color-text-primary'),
      'editor.selectionBackground': token('--color-accent-muted'),
    },
    tokenColors: SYNTAX.map(([key, scope]) => ({
      scope,
      settings: { foreground: syntaxColor(key) },
    })),
  };
}
