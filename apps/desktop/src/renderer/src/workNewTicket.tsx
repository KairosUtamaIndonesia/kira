/**
 * Writing a new ticket, in a dialog over the queue. It reads like the document a ticket
 * becomes: its kind, a large title, About (rich markdown), then Done when as ruled check
 * rows. A ticket is written as a draft, so nothing insists on the checks; the refusal that
 * matters comes when it is marked ready for an agent.
 */
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
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

interface Props {
  kinds: TicketKind[];
  kindIcons: Record<TicketKind, LucideIcon>;
  refusal: string | null;
  onCancel: () => void;
  onWrite: (draft: TicketDraft) => Promise<void>;
}

const KIND_WORDS: Record<TicketKind, string> = {
  prototype: 'Try an idea and throw it away',
  bug: 'Something is broken',
  feature: 'Something new to build',
  refactor: 'Change the code, not the behavior',
  question: 'Something to find out',
  research: 'Read and report back',
  spec: 'Say what to build, in detail',
  map: 'Plan work too big for one ticket',
};

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
      <DialogHeader
        title="New ticket"
        subtitle="It starts as a draft. Make it ready when it is clear enough to start."
        onOpenChange={(next) => {
          if (!next && !busy) onCancel();
        }}
      />
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div {...stylex.props(ui.body)} onKeyDown={onKeyDown}>
        {refusal !== null && (
          <Banner status="error" title="Ticket was not created" description={refusal} />
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
          <kbd {...stylex.props(ui.kbd)}>⌘ Enter</kbd> to create
        </Text>
        <span {...stylex.props(ui.footButtons)}>
          <Button label="Cancel" size="sm" variant="ghost" isDisabled={busy} onClick={onCancel} />
          <Button
            label={busy ? 'Creating ticket' : 'Create ticket'}
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
            description: KIND_WORDS[each],
            icon: <Icon icon={kindIcons[each]} size="sm" />,
            endContent: each === kind ? <Icon icon={Check} size="sm" /> : undefined,
            onClick: () => setKind(each),
          }))}
        />
        <span {...stylex.props(ui.docHint)}>can’t change once written</span>
      </div>
      <input
        aria-label="Title"
        placeholder="Ticket title"
        value={title}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        onChange={(event) => setTitle(event.target.value)}
        {...stylex.props(ui.docTitle)}
      />
      <div {...stylex.props(ui.docSection)}>
        <span {...stylex.props(ui.docLabel)}>About</span>
        <MarkdownEditor
          label="Description"
          placeholder="What to build, and why. Markdown works."
          onChange={setBody}
        />
      </div>
      <div {...stylex.props(ui.docSection)}>
        <span {...stylex.props(ui.docLabel)}>Done when</span>
        <ul {...stylex.props(ui.checks)}>
          {criteria.map((line, at) => (
            <li key={at} {...stylex.props(ui.check)}>
              <span {...stylex.props(ui.checkMark)} aria-hidden />
              <input
                aria-label={`Criterion ${at + 1}`}
                placeholder="A check that says it is done"
                value={line}
                onChange={(event) =>
                  setCriteria(criteria.map((each, i) => (i === at ? event.target.value : each)))
                }
                {...stylex.props(ui.checkInput)}
              />
              {criteria.length > 1 && (
                <span {...stylex.props(ui.checkRemove)}>
                  <IconButton
                    label={`Remove criterion ${at + 1}`}
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
            label="Add criterion"
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

const bare = {
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
    alignItems: 'center',
    gap: spacingVars['--spacing-3'],
    minHeight: 36,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-background-muted'],
  },
  checkMark: {
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
