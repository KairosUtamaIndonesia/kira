/**
 * A rich markdown editor: the text is markdown going in and markdown coming out, so what
 * it holds is exactly what a ticket stores and what the ticket view renders. Tiptap draws
 * the document; its content's look is `.rich-editor` in `styles.css`.
 *
 * Only what markdown can say is offered — bold, italic, code, lists, a quote, a code
 * block — so nothing typed here is lost when the text is saved.
 */
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
  borderVars,
  colorVars,
  radiusVars,
  spacingVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import { Markdown } from '@tiptap/markdown';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Bold,
  Code,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  SquareCode,
} from 'lucide-react';
import { copy } from './workCopy.ts';

interface Action {
  label: string;
  icon: LucideIcon;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

const ACTIONS: Action[] = [
  {
    label: copy.toolbar.bold,
    icon: Bold,
    isActive: (e) => e.isActive('bold'),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    label: copy.toolbar.italic,
    icon: Italic,
    isActive: (e) => e.isActive('italic'),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    label: copy.toolbar.code,
    icon: Code,
    isActive: (e) => e.isActive('code'),
    run: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    label: copy.toolbar.bulletedList,
    icon: List,
    isActive: (e) => e.isActive('bulletList'),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: copy.toolbar.numberedList,
    icon: ListOrdered,
    isActive: (e) => e.isActive('orderedList'),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: copy.toolbar.quote,
    icon: Quote,
    isActive: (e) => e.isActive('blockquote'),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    label: copy.toolbar.codeBlock,
    icon: SquareCode,
    isActive: (e) => e.isActive('codeBlock'),
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
];

export function MarkdownEditor({
  label,
  placeholder,
  initial = '',
  onChange,
  revealToolbarOnFocus = false,
}: {
  label: string;
  placeholder: string;
  /** Read once, when the editor is made; the editor owns the text after that. */
  initial?: string;
  onChange: (markdown: string) => void;
  /**
   * Hold the toolbar back until the editor is being written in. A surface that is read more
   * often than it is written — a ticket's description — keeps the toolbar's room, so nothing
   * moves when it appears, but shows it only while the editor has the focus. Tabbing into the
   * toolbar itself counts as focus, so none of its buttons is ever focusable while unseen.
   */
  revealToolbarOnFocus?: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false },
      }),
      Markdown,
      Placeholder.configure({ placeholder }),
    ],
    content: initial,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: 'rich-editor',
        'aria-label': label,
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getMarkdown()),
  });

  return (
    <div {...stylex.props(styles.frame, revealToolbarOnFocus && styles.readMoreThanWritten)}>
      {editor !== null && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}

/** A link's address as the editor will keep it: web and mail addresses only. */
function linkAddress(typed: string): string | null {
  const text = typed.trim();
  if (text === '') return null;
  const address = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  return /^(https?:|mailto:)/i.test(address) ? address : null;
}

function Toolbar({ editor }: { editor: Editor }) {
  const { active, link } = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      active: ACTIONS.map((action) => action.isActive(current)),
      link: current.isActive('link'),
    }),
  });
  const [linking, setLinking] = useState(false);
  const [address, setAddress] = useState('');

  const openLink = (): void => {
    setAddress(editor.getAttributes('link')['href'] ?? '');
    setLinking(true);
  };
  const closeLink = (): void => {
    setLinking(false);
    editor.commands.focus();
  };
  const applyLink = (): void => {
    const href = linkAddress(address);
    if (href === null) return;
    const chain = editor.chain().focus();
    if (editor.state.selection.empty && !link) {
      chain
        .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
        .run();
    } else {
      chain.extendMarkRange('link').setLink({ href }).run();
    }
    setLinking(false);
  };

  return (
    <>
      <div {...stylex.props(styles.toolbar)} role="toolbar" aria-label={copy.toolbar.label}>
        {ACTIONS.map((action, at) => (
          <IconButton
            key={action.label}
            label={action.label}
            tooltip={action.label}
            icon={<Icon icon={action.icon} size="sm" />}
            size="sm"
            variant={active[at] ? 'secondary' : 'ghost'}
            onClick={() => action.run(editor)}
          />
        ))}
        <IconButton
          label={copy.toolbar.link}
          tooltip={copy.toolbar.link}
          icon={<Icon icon={LinkIcon} size="sm" />}
          size="sm"
          variant={link || linking ? 'secondary' : 'ghost'}
          onClick={() => (linking ? closeLink() : openLink())}
        />
      </div>
      {linking && (
        <div {...stylex.props(styles.linkRow)}>
          <div {...stylex.props(styles.linkField)}>
            <TextInput
              label={copy.toolbar.linkAddress}
              isLabelHidden
              placeholder={copy.toolbar.linkPlaceholder}
              size="sm"
              value={address}
              onChange={setAddress}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.stopPropagation();
                  applyLink();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  closeLink();
                }
              }}
            />
          </div>
          <Button
            label={copy.toolbar.apply}
            size="sm"
            variant="secondary"
            isDisabled={linkAddress(address) === null}
            onClick={applyLink}
          />
          {link && (
            <Button
              label={copy.toolbar.removeLink}
              size="sm"
              variant="ghost"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                setLinking(false);
              }}
            />
          )}
        </div>
      )}
    </>
  );
}

const styles = stylex.create({
  linkRow: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-2'] },
  linkField: { flex: 1, minWidth: 0 },
  frame: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    paddingBlockStart: spacingVars['--spacing-1'],
  },
  /**
   * For a surface that is read more than written: the toolbar is invisible until the editor
   * has the focus, but keeps its room, so an editor that is being read does not shift under
   * the pointer when the toolbar appears.
   */
  readMoreThanWritten: {
    '--toolbar-visibility': { default: 'hidden', ':focus-within': 'visible' },
  },
  toolbar: {
    visibility: 'var(--toolbar-visibility, visible)',
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    paddingBlockEnd: spacingVars['--spacing-2'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-background-muted'],
    borderRadius: radiusVars['--radius-inner'],
    // Ghost buttons at the start of a row: the first one's glyph lines up with the text below.
    marginInlineStart: `calc(-1 * ${spacingVars['--spacing-2']})`,
  },
});
