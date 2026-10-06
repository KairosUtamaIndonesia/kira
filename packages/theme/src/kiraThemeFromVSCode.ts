import { defineSyntaxTheme, defineTheme } from '@astryxdesign/core/theme';
import type { SyntaxThemeTokenInput } from '@astryxdesign/core/theme/syntax';
import { kiraTheme } from './built/kira';
import type { ImportedVSCodeTheme, SyntaxColor } from './vscodeTheme';

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

function valueForMode(value: string, mode: 'light' | 'dark'): string {
  const pair = /^light-dark\((.*),\s*(.*)\)$/u.exec(value);
  return pair ? (mode === 'light' ? pair[1]! : pair[2]!) : value;
}

function defaultToken(name: string, mode: 'light' | 'dark'): string {
  const value = kiraTheme.tokens[name];
  return value === undefined ? '' : valueForMode(value, mode);
}

function selectedToken(
  theme: ImportedVSCodeTheme | undefined,
  name: string,
  mode: 'light' | 'dark',
): string {
  return theme?.tokens[name] ?? defaultToken(name, mode);
}

function selectedSyntax(
  theme: ImportedVSCodeTheme | undefined,
  token: SyntaxColor,
  mode: 'light' | 'dark',
): string {
  return theme?.syntax[token] ?? defaultToken(`--color-syntax-${token}`, mode);
}

/** Apply separate imported light and dark VS Code variants over Kira's base. */
export function kiraThemeFromVSCode(
  light: ImportedVSCodeTheme | undefined,
  dark: ImportedVSCodeTheme | undefined,
) {
  if (!light && !dark) return kiraTheme;

  const names = new Set([...Object.keys(light?.tokens ?? {}), ...Object.keys(dark?.tokens ?? {})]);
  const tokens: Record<string, string | [string, string]> = {};
  for (const name of names) {
    tokens[name] = [selectedToken(light, name, 'light'), selectedToken(dark, name, 'dark')];
  }

  const syntax = Object.fromEntries(
    SYNTAX_COLORS.map((token) => [
      token,
      [selectedSyntax(light, token, 'light'), selectedSyntax(dark, token, 'dark')],
    ]),
  ) as SyntaxThemeTokenInput;
  const name = `kira-vscode-${(light?.id ?? 'openchamber').replace(/[^a-z0-9-]/giu, '-')}-${(dark?.id ?? 'openchamber').replace(/[^a-z0-9-]/giu, '-')}`;

  return defineTheme({
    name,
    extends: kiraTheme,
    tokens,
    syntax: defineSyntaxTheme({ name, tokens: syntax }),
  });
}

export function selectedVSCodeTheme(
  themes: readonly ImportedVSCodeTheme[],
  id: string | null,
): ImportedVSCodeTheme | undefined {
  return id === null ? undefined : themes.find((theme) => theme.id === id);
}
