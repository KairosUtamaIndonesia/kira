/** CodeMirror surface used by workspace file previews and edits. */
import { indentWithTab, defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap } from '@codemirror/search';
import {
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from '@codemirror/view';
import type { BundledLanguage, Highlighter, LanguageInput } from 'shiki';
import { useEffect, useRef } from 'react';
import { languageOf } from './filePreview';

let highlighter: Promise<Highlighter> | undefined;
const SHIKI_THEME_LIGHT = 'github-light-default';
const SHIKI_THEME_DARK = 'github-dark-default';

export function CodeMirrorFile({
  path,
  value,
  readOnly,
  onChange,
  onSave,
}: {
  path: string;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onSave?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);

  useMountEffect(() => {
    const parent = host.current;
    if (!parent) return;
    let cancelled = false;
    let view: EditorView | undefined;

    void createEditor(path, value, readOnly, () => onSave?.()).then((extensions) => {
      if (cancelled || !host.current) return;
      extensions.push(
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString());
        }),
      );
      view = new EditorView({
        state: EditorState.create({ doc: value, extensions }),
        parent: host.current,
      });
    });

    return () => {
      cancelled = true;
      view?.destroy();
    };
  });

  return <div ref={host} className="file-code-editor" aria-label={`${path} code`} />;
}

async function createEditor(path: string, value: string, readOnly: boolean, save: () => void) {
  const filename = path.split('/').pop() ?? path;
  const extension = filename.split('.').pop()?.toLowerCase();
  const language = languageFor(extension);
  const shikiLanguage = languageOf(path) ?? extension;
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const theme = currentTheme === 'light' ? SHIKI_THEME_LIGHT : SHIKI_THEME_DARK;
  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    history(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    search(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.theme({
      '&': {
        height: '100%',
        color: 'var(--color-text-primary)',
        backgroundColor: 'var(--color-background-surface)',
        fontSize: '13px',
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: 'var(--font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
      },
      '.cm-gutters': {
        color: 'var(--color-text-secondary)',
        backgroundColor: 'var(--color-background-surface)',
        borderRight: '1px solid var(--color-border)',
      },
      '.cm-activeLine, .cm-activeLineGutter': {
        backgroundColor: 'color-mix(in srgb, var(--color-text-primary) 5%, transparent)',
      },
      '.cm-content': { caretColor: 'var(--color-text-primary)' },
      '.cm-cursor': { borderLeftColor: 'var(--color-text-primary)' },
    }),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...closeBracketsKeymap,
      ...searchKeymap,
      indentWithTab,
      ...(!readOnly
        ? [
            {
              key: 'Mod-s',
              run: () => {
                save();
                return true;
              },
            },
          ]
        : []),
    ]),
    EditorView.contentAttributes.of({ 'aria-label': `Edit ${filename}` }),
  ];
  if (language) extensions.push(language);

  if (shikiLanguage) {
    extensions.push(shikiDecorationExtension(shikiLanguage, theme));
  }

  return extensions;
}

function languageFor(extension: string | undefined): Extension | undefined {
  switch (extension) {
    case 'js':
    case 'jsx':
      return javascript({ jsx: true });
    case 'ts':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ typescript: true, jsx: true });
    case 'json':
    case 'jsonc':
      return json();
    case 'css':
      return css();
    case 'html':
    case 'htm':
      return html();
    case 'md':
    case 'mdx':
      return markdown();
    case 'py':
      return python();
    default:
      return undefined;
  }
}

const replaceShikiDecorations = StateEffect.define<import('@codemirror/view').DecorationSet>();

const shikiDecorations = StateField.define<import('@codemirror/view').DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(replaceShikiDecorations)) next = effect.value;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function shikiDecorationExtension(language: string, theme: string) {
  return [
    shikiDecorations,
    ViewPlugin.fromClass(
      class {
        private timer: ReturnType<typeof setTimeout> | undefined;
        private generation = 0;

        constructor(view: EditorView) {
          void this.highlight(view);
        }

        update(update: import('@codemirror/view').ViewUpdate) {
          if (!update.docChanged) return;
          if (this.timer) clearTimeout(this.timer);
          this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.highlight(update.view);
          }, 180);
        }

        private async highlight(view: EditorView) {
          const generation = ++this.generation;
          const source = view.state.doc.toString();
          try {
            const shiki = await (highlighter ??= import('shiki').then(({ createHighlighter }) =>
              createHighlighter({ themes: [SHIKI_THEME_LIGHT, SHIKI_THEME_DARK], langs: [] }),
            ));
            if (!shiki.getLoadedLanguages().includes(language)) {
              await shiki.loadLanguage(language as unknown as LanguageInput);
            }
            if (!shiki.getLoadedLanguages().includes(language)) return;
            const result = await shiki.codeToTokens(source, {
              lang: language as unknown as BundledLanguage,
              theme,
            });
            if (generation !== this.generation || view.state.doc.toString() !== source) return;
            const builder = new RangeSetBuilder<Decoration>();
            for (
              let index = 0;
              index < result.tokens.length && index < view.state.doc.lines;
              index += 1
            ) {
              const line = view.state.doc.line(index + 1);
              let position = line.from;
              for (const token of result.tokens[index] ?? []) {
                const from = position;
                const to = Math.min(line.to, from + token.content.length);
                position += token.content.length;
                if (to <= from || !token.color) continue;
                const fontStyle = token.fontStyle ?? 0;
                const style = `color:${token.color};${fontStyle & 1 ? 'font-style:italic;' : ''}${fontStyle & 2 ? 'font-weight:bold;' : ''}${fontStyle & 4 ? 'text-decoration:underline;' : ''}`;
                builder.add(from, to, Decoration.mark({ attributes: { style } }));
              }
            }
            view.dispatch({ effects: replaceShikiDecorations.of(builder.finish()) });
          } catch {
            // The CodeMirror language extension remains as the local highlighter fallback.
          }
        }

        destroy() {
          this.generation += 1;
          if (this.timer) clearTimeout(this.timer);
        }
      },
    ),
  ];
}

function useMountEffect(effect: () => void | (() => void)): void {
  /* eslint-disable no-restricted-syntax */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
  /* eslint-enable no-restricted-syntax */
}
