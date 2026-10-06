import { parseVSCodeJson } from './vscodeJson.ts';

export type ThemeMode = 'light' | 'dark';

export type SyntaxColor =
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'function'
  | 'type'
  | 'variable'
  | 'operator'
  | 'constant'
  | 'tag'
  | 'attribute'
  | 'property'
  | 'punctuation'
  | 'background';

export interface ImportedVSCodeTheme {
  id: string;
  name: string;
  variant: ThemeMode;
  author?: string;
  tokens: Record<string, string>;
  syntax: Partial<Record<SyntaxColor, string>>;
}

interface TokenRule {
  scope?: string | string[];
  settings?: { foreground?: string };
}

interface VSCodeThemeSource {
  name?: string;
  author?: string;
  type?: string;
  include?: string;
  colors?: Record<string, string | null>;
  tokenColors?: TokenRule[] | string;
  semanticHighlighting?: boolean;
  semanticTokenColors?: Record<string, string | { foreground?: string }>;
}

const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu;
const FALLBACK_ACCENT: Record<ThemeMode, string> = {
  light: '#b35017',
  dark: '#da7c47',
};

function parseSource(text: string): VSCodeThemeSource {
  let value: unknown;
  try {
    value = parseVSCodeJson(text);
  } catch (error) {
    throw error instanceof Error ? error : new Error('Invalid VS Code JSON.');
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Not a supported VS Code color theme.');
  }
  const source = value as VSCodeThemeSource;
  if (
    (source.name !== undefined && (typeof source.name !== 'string' || source.name.length > 160)) ||
    (source.author !== undefined &&
      (typeof source.author !== 'string' || source.author.length > 160)) ||
    (source.type !== undefined &&
      !['light', 'dark', 'hc', 'hc-black', 'hc-light'].includes(source.type)) ||
    (source.semanticHighlighting !== undefined && typeof source.semanticHighlighting !== 'boolean')
  )
    throw new Error('Not a supported VS Code color theme.');

  if (source.colors !== undefined) {
    if (
      typeof source.colors !== 'object' ||
      source.colors === null ||
      Array.isArray(source.colors)
    ) {
      throw new Error('Not a supported VS Code color theme.');
    }
    if (Object.values(source.colors).some((color) => color !== null && typeof color !== 'string')) {
      throw new Error('VS Code theme colors must be color strings.');
    }
  }
  if (source.semanticTokenColors !== undefined) {
    if (
      typeof source.semanticTokenColors !== 'object' ||
      source.semanticTokenColors === null ||
      Array.isArray(source.semanticTokenColors) ||
      Object.values(source.semanticTokenColors).some(
        (value) =>
          typeof value !== 'string' &&
          (typeof value !== 'object' ||
            value === null ||
            Array.isArray(value) ||
            (value.foreground !== undefined && typeof value.foreground !== 'string')),
      )
    )
      throw new Error('Not a supported VS Code color theme.');
  }
  if (
    source.tokenColors !== undefined &&
    typeof source.tokenColors !== 'string' &&
    !Array.isArray(source.tokenColors)
  ) {
    throw new Error('Not a supported VS Code color theme.');
  }
  if (typeof source.tokenColors === 'string' || source.include) {
    throw new Error(
      'This theme references another file. Export it from VS Code with Developer: Generate Color Theme From Current Settings, then import the generated JSON.',
    );
  }
  if (Array.isArray(source.tokenColors)) {
    for (const rule of source.tokenColors) {
      if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
        throw new Error('Not a supported VS Code color theme.');
      }
      const item = rule as TokenRule;
      const validScope =
        item.scope === undefined ||
        typeof item.scope === 'string' ||
        (Array.isArray(item.scope) && item.scope.every((scope) => typeof scope === 'string'));
      const validSettings =
        item.settings === undefined ||
        (typeof item.settings === 'object' &&
          item.settings !== null &&
          !Array.isArray(item.settings) &&
          (item.settings.foreground === undefined || typeof item.settings.foreground === 'string'));
      if (!validScope || !validSettings) throw new Error('Not a supported VS Code color theme.');
    }
  }
  return source;
}

function colorIn(source: VSCodeThemeSource, name: string): string | undefined {
  const color = source.colors?.[name];
  return typeof color === 'string' && HEX_COLOR.test(color) ? color : undefined;
}

function scopeMatches(scope: string, candidate: string): boolean {
  return scope === candidate || candidate.startsWith(`${scope}.`);
}

function textMateColor(rules: TokenRule[], scopes: string[]): string | undefined {
  for (const candidate of scopes) {
    let best: { color: string; specificity: number } | undefined;
    for (const rule of rules) {
      const color = rule.settings?.foreground;
      if (!color || !HEX_COLOR.test(color)) continue;
      const ruleScopes = Array.isArray(rule.scope) ? rule.scope : [rule.scope ?? ''];
      for (const item of ruleScopes.flatMap((part) => part.split(','))) {
        const scope = item.trim();
        if (
          scope &&
          scopeMatches(scope, candidate) &&
          (!best || scope.length >= best.specificity)
        ) {
          best = { color, specificity: scope.length };
        }
      }
    }
    if (best) return best.color;
  }
  return undefined;
}

function semanticColor(source: VSCodeThemeSource, names: string[]): string | undefined {
  const colors = source.semanticHighlighting === false ? undefined : source.semanticTokenColors;
  for (const name of [...names, '*']) {
    const value = colors?.[name];
    const color = typeof value === 'string' ? value : value?.foreground;
    if (color && HEX_COLOR.test(color)) return color;
  }
  return undefined;
}

function contrastColor(background: string): string {
  const hex = background.slice(1);
  const channels =
    hex.length < 6
      ? [...hex.slice(0, 3)].map((channel) => Number.parseInt(channel + channel, 16))
      : [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]! > 0.179
    ? '#111111'
    : '#ffffff';
}

function withAlpha(color: string, alpha: string): string {
  const channels = color.slice(1);
  const rgb =
    channels.length < 6
      ? [...channels.slice(0, 3)].map((channel) => `${channel}${channel}`).join('')
      : channels.slice(0, 6);
  return `#${rgb}${alpha}`;
}

function stableId(name: string, variant: ThemeMode, text: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/\b(light|dark)\b/gu, '')
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, '') || 'vscode-theme';
  let hash = 2166136261;
  for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `vscode-${slug}-${variant}-${(hash >>> 0).toString(16)}`;
}

/** Convert a standalone VS Code color theme into colors Kira can apply. */
export function importVSCodeTheme(text: string, filename: string): ImportedVSCodeTheme {
  const source = parseSource(text);
  const editorBackground = colorIn(source, 'editor.background');
  if (!editorBackground) throw new Error('The theme needs an editor.background color.');

  const variant: ThemeMode = source.type
    ? ['dark', 'hc', 'hc-black'].includes(source.type)
      ? 'dark'
      : 'light'
    : contrastColor(editorBackground) === '#111111'
      ? 'light'
      : 'dark';
  const accent =
    colorIn(source, 'button.background') ??
    colorIn(source, 'textLink.foreground') ??
    colorIn(source, 'focusBorder') ??
    FALLBACK_ACCENT[variant];
  const syntaxRules = Array.isArray(source.tokenColors) ? source.tokenColors : [];
  const pick = (semantic: string[], scopes: string[]) =>
    semanticColor(source, semantic) ?? textMateColor(syntaxRules, scopes);
  const tokens: Record<string, string> = {
    '--color-background-surface': editorBackground,
    '--color-background-body': colorIn(source, 'sideBar.background') ?? editorBackground,
    '--color-text-primary':
      colorIn(source, 'editor.foreground') ??
      colorIn(source, 'foreground') ??
      contrastColor(editorBackground),
    '--color-accent': accent,
    '--color-accent-muted': withAlpha(accent, '80'),
    '--color-on-accent': colorIn(source, 'button.foreground') ?? contrastColor(accent),
  };

  const card = colorIn(source, 'panel.background') ?? colorIn(source, 'editorWidget.background');
  const popover =
    colorIn(source, 'editorWidget.background') ?? colorIn(source, 'dropdown.background');
  const border =
    colorIn(source, 'widget.border') ??
    colorIn(source, 'panel.border') ??
    colorIn(source, 'sideBar.border');
  const borderEmphasized = colorIn(source, 'focusBorder') ?? border;
  const secondary =
    colorIn(source, 'descriptionForeground') ?? colorIn(source, 'sideBar.foreground');
  if (card) tokens['--color-background-card'] = card;
  if (popover) tokens['--color-background-popover'] = popover;
  if (border) tokens['--color-border'] = border;
  if (borderEmphasized) tokens['--color-border-emphasized'] = borderEmphasized;
  if (secondary) tokens['--color-text-secondary'] = secondary;

  const syntax: ImportedVSCodeTheme['syntax'] = {};
  const mappings: Array<[SyntaxColor, string[], string[]]> = [
    ['keyword', ['keyword', 'storage'], ['keyword.control', 'storage.type']],
    ['string', ['string'], ['string.quoted', 'string.template']],
    ['comment', ['comment'], ['comment.line', 'comment.block']],
    ['number', ['number'], ['constant.numeric']],
    ['function', ['function'], ['entity.name.function', 'support.function']],
    ['variable', ['variable'], ['variable.other.readwrite', 'variable']],
    ['type', ['type', 'class'], ['entity.name.type', 'support.type', 'support.class']],
    ['operator', ['operator'], ['keyword.operator']],
    ['constant', ['enumMember', 'variable.readonly'], ['constant.language', 'constant.other']],
    ['tag', ['tag'], ['entity.name.tag']],
    ['attribute', ['property'], ['entity.other.attribute-name']],
    ['property', ['property'], ['variable.other.property', 'support.type.property-name']],
    ['punctuation', [], ['punctuation', 'punctuation.separator']],
  ];
  for (const [token, semantic, scopes] of mappings) {
    const color = pick(semantic, scopes);
    if (color) syntax[token] = color;
  }
  syntax.background = colorIn(source, 'textPreformat.background') ?? editorBackground;

  const name =
    source.name?.trim() ||
    filename
      .replace(/\.(jsonc?|code-theme)$/iu, '')
      .replace(/[-_]color[-_]theme$/iu, '')
      .trim() ||
    'VS Code';
  return {
    id: stableId(name, variant, text),
    name,
    variant,
    ...(source.author ? { author: source.author } : {}),
    tokens,
    syntax,
  };
}
