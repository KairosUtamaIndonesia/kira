/**
 * A rich markdown editor: the text is markdown going in and markdown coming out, so what
 * it holds is exactly what a ticket stores and what the ticket view renders. Tiptap draws
 * the document; its content's look is `.rich-editor` in `styles.css`.
 *
 * Only what markdown can say is offered — bold, italic, code, lists, a quote, a code
 * block — so nothing typed here is lost when the text is saved.
 */
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
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
import type { LucideIcon } from 'lucide-react';
import { Bold, Code, Italic, List, ListOrdered, Quote, SquareCode } from 'lucide-react';

interface Action {
  label: string;
  icon: LucideIcon;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

const ACTIONS: Action[] = [
  {
    label: 'Bold',
    icon: Bold,
    isActive: (e) => e.isActive('bold'),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    label: 'Italic',
    icon: Italic,
    isActive: (e) => e.isActive('italic'),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    label: 'Code',
    icon: Code,
    isActive: (e) => e.isActive('code'),
    run: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    label: 'Bulleted list',
    icon: List,
    isActive: (e) => e.isActive('bulletList'),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: 'Numbered list',
    icon: ListOrdered,
    isActive: (e) => e.isActive('orderedList'),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: 'Quote',
    icon: Quote,
    isActive: (e) => e.isActive('blockquote'),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    label: 'Code block',
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
}: {
  label: string;
  placeholder: string;
  /** Read once, when the editor is made; the editor owns the text after that. */
  initial?: string;
  onChange: (markdown: string) => void;
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
    <div {...stylex.props(styles.frame)}>
      {editor !== null && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ACTIONS.map((action) => action.isActive(current)),
  });

  return (
    <div {...stylex.props(styles.toolbar)} role="toolbar" aria-label="Formatting">
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
    </div>
  );
}

const styles = stylex.create({
  frame: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    paddingBlockStart: spacingVars['--spacing-1'],
  },
  toolbar: {
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
