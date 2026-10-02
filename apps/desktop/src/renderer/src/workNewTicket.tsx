/**
 * Writing a new ticket, in a dialog over the queue. It reads like the document a ticket
 * becomes: its kind, a large title, About (rich markdown), then Done when as ruled check
 * rows. A ticket is written as a draft, so nothing insists on the checks; a person adds them
 * before making it Ready.
 */
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { FlushDialogHeader } from './dialogHeader.tsx';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import {
  borderVars,
  colorVars,
  radiusVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { Check, Plus, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import type { TicketDraft, TicketKind } from '../../preload/bridge.ts';
import { MarkdownEditor } from './markdownEditor.tsx';
import { copy } from './workCopy.ts';

interface Props {
  kinds: TicketKind[];
  kindIcons: Record<TicketKind, LucideIcon>;
  refusal: string | null;
  onCancel: () => void;
  onWrite: (draft: TicketDraft) => Promise<void>;
}

export function NewTicketDialog({ kinds, kindIcons, refusal, onCancel, onWrite }: Props) {
  const [kind, setKind] = useState<TicketKind>('feature');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [criteria, setCriteria] = useState<string[]>(['']);
  const [busy, setBusy] = useState(false);

  const create = (): void => {
    if (busy) return;
    setBusy(true);
    void onWrite({
      kind,
      title,
      body,
      criteria: criteria.filter((each) => each.trim() !== ''),
    }).finally(() => setBusy(false));
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      create();
    }
  };

  return (
    <Dialog
      isOpen
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
      purpose="form"
      width={640}
    >
      <FlushDialogHeader
        title={copy.editor.newTitle}
        subtitle={copy.editor.newSubtitle}
        onOpenChange={(next) => {
          if (!next && !busy) onCancel();
        }}
      />
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div {...stylex.props(ui.body)} onKeyDown={onKeyDown}>
        {refusal !== null && (
          <Banner status="error" title={copy.refused.createTitle} description={refusal} />
        )}
        <Document
          kinds={kinds}
          kindIcons={kindIcons}
          kind={kind}
          setKind={setKind}
          title={title}
          setTitle={setTitle}
          setBody={setBody}
          criteria={criteria}
          setCriteria={setCriteria}
        />
      </div>
      <div {...stylex.props(ui.foot)}>
        <Text type="supporting" color="secondary">
          <kbd {...stylex.props(ui.kbd)}>⌘ Enter</kbd> {copy.editor.createHint}
        </Text>
        <span {...stylex.props(ui.footButtons)}>
          <Button
            label={copy.actions.cancel}
            size="sm"
            variant="ghost"
            isDisabled={busy}
            onClick={onCancel}
          />
          <Button
            label={busy ? copy.editor.creating : copy.editor.create}
            size="sm"
            variant="primary"
            isDisabled={busy}
            onClick={create}
          />
        </span>
      </div>
    </Dialog>
  );
}

interface DocumentProps {
  kinds: TicketKind[];
  kindIcons: Record<TicketKind, LucideIcon>;
  kind: TicketKind;
  setKind: (kind: TicketKind) => void;
  title: string;
  setTitle: (title: string) => void;
  setBody: (body: string) => void;
  criteria: string[];
  setCriteria: (criteria: string[]) => void;
}

function Document({
  kinds,
  kindIcons,
  kind,
  setKind,
  title,
  setTitle,
  setBody,
  criteria,
  setCriteria,
}: DocumentProps) {
  return (
    <>
      <div {...stylex.props(ui.docMeta)}>
        <DropdownMenu
          button={{
            label: kind,
            icon: <Icon icon={kindIcons[kind]} size="sm" />,
            size: 'sm',
            variant: 'secondary',
          }}
          hasChevron
          menuWidth={300}
          items={kinds.map((each) => ({
            label: each,
            description: copy.kinds[each],
            icon: <Icon icon={kindIcons[each]} size="sm" />,
            endContent: each === kind ? <Icon icon={Check} size="sm" /> : undefined,
            onClick: () => setKind(each),
          }))}
        />
        <span {...stylex.props(ui.docHint)}>{copy.editor.kindLocked}</span>
      </div>
      <TicketFields
        title={title}
        setTitle={setTitle}
        setBody={setBody}
        criteria={criteria}
        setCriteria={setCriteria}
        focusTitle
      />
    </>
  );
}

/**
 * The words of a ticket, laid out as the document it becomes: a large title, About in the
 * rich editor, then Done when as ruled check rows. New ticket and Edit share it, so writing
 * and correcting look the same.
 */
export function TicketFields({
  title,
  setTitle,
  initialBody = '',
  setBody,
  criteria,
  setCriteria,
  focusTitle = false,
}: {
  title: string;
  setTitle: (title: string) => void;
  /** Read once, when the editor is made. */
  initialBody?: string;
  setBody: (body: string) => void;
  criteria: string[];
  setCriteria: (criteria: string[]) => void;
  focusTitle?: boolean;
}) {
  return (
    <>
      <textarea
        rows={1}
        aria-label={copy.editor.titleLabel}
        placeholder={copy.editor.titlePlaceholder}
        value={title}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={focusTitle}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={oneLine}
        {...stylex.props(ui.docTitle)}
      />
      <div {...stylex.props(ui.docSection)}>
        <span {...stylex.props(ui.docLabel)}>{copy.ticket.about}</span>
        <MarkdownEditor
          label={copy.ticket.about}
          initial={initialBody}
          placeholder={copy.editor.aboutPlaceholder}
          onChange={setBody}
        />
      </div>
      <div {...stylex.props(ui.docSection)}>
        <span {...stylex.props(ui.docLabel)}>{copy.ticket.doneWhen}</span>
        <ul {...stylex.props(ui.checks)}>
          {criteria.map((line, at) => (
            <li key={at} {...stylex.props(ui.check)}>
              <span {...stylex.props(ui.checkMark)} aria-hidden />
              <textarea
                rows={1}
                aria-label={copy.editor.checkLabel(at + 1)}
                placeholder={copy.editor.checkPlaceholder}
                value={line}
                onChange={(event) =>
                  setCriteria(criteria.map((each, i) => (i === at ? event.target.value : each)))
                }
                onKeyDown={oneLine}
                {...stylex.props(ui.checkInput)}
              />
              {criteria.length > 1 && (
                <span {...stylex.props(ui.checkRemove)}>
                  <IconButton
                    label={copy.editor.removeCheck(at + 1)}
                    icon={<Icon icon={X} size="sm" />}
                    variant="ghost"
                    size="sm"
                    onClick={() => setCriteria(criteria.filter((_each, i) => i !== at))}
                  />
                </span>
              )}
            </li>
          ))}
        </ul>
        <span {...stylex.props(ui.docAdd)}>
          <Button
            label={copy.editor.addCheck}
            icon={<Icon icon={Plus} size="sm" />}
            size="sm"
            variant="ghost"
            onClick={() => setCriteria([...criteria, ''])}
          />
        </span>
      </div>
    </>
  );
}

/**
 * A title or a check is one line of meaning that wraps: Enter does not break it. Shared with
 * the ticket's own fields, which are one-line fields of the same two kinds.
 */
export function oneLine(event: KeyboardEvent<HTMLTextAreaElement>): void {
  if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) event.preventDefault();
}

const bare = {
  // Grows with what is typed, so a long title or check wraps instead of hiding.
  fieldSizing: 'content',
  resize: 'none',
  width: '100%',
  padding: 0,
  borderWidth: 0,
  outline: 'none',
  backgroundColor: 'transparent',
  color: colorVars['--color-text-primary'],
  fontFamily: 'inherit',
} as const;

const ui = stylex.create({
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-4'],
    paddingBlock: spacingVars['--spacing-2'],
  },
  foot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-3'],
    paddingBlockStart: spacingVars['--spacing-4'],
  },
  footButtons: { display: 'flex', gap: spacingVars['--spacing-2'] },
  kbd: {
    paddingInline: 4,
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border-emphasized'],
    borderRadius: radiusVars['--radius-inner'],
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-xs'],
  },
  docMeta: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-3'] },
  docHint: {
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  docTitle: {
    ...bare,
    fontFamily: typographyVars['--font-family-heading'],
    fontSize: '1.375rem',
    fontWeight: 600,
    lineHeight: 1.3,
    '::placeholder': { color: colorVars['--color-text-secondary'] },
  },
  docSection: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'] },
  docLabel: {
    fontSize: textSizeVars['--font-size-base'],
    fontWeight: 500,
    color: colorVars['--color-text-primary'],
  },
  checks: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none' },
  check: {
    '--row-reveal': { default: '0', ':hover': '1', ':focus-within': '1' },
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacingVars['--spacing-3'],
    paddingBlock: spacingVars['--spacing-2'],
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-background-muted'],
  },
  checkMark: {
    marginBlockStart: 4,
    width: 14,
    height: 14,
    flexShrink: 0,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colorVars['--color-accent'],
  },
  checkInput: {
    ...bare,
    flex: 1,
    minWidth: 0,
    fontSize: textSizeVars['--font-size-base'],
    '::placeholder': { color: colorVars['--color-text-secondary'] },
  },
  checkRemove: { display: 'inline-flex', opacity: 'var(--row-reveal)' },
  docAdd: { display: 'flex', marginInlineStart: `calc(-1 * ${spacingVars['--spacing-3']})` },
});
