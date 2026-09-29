/**
 * PROTOTYPE — throwaway. Writing a new ticket in a modal dialog instead of the drawer,
 * three ways, switchable from the dialog's own header in development builds.
 *
 * Question it answers: how much of a ticket should the dialog ask for up front? A is the
 * old form, lifted into a dialog. B reads like the document a ticket becomes (a big
 * title, then the words, then the checks). C asks only for a kind and a title and keeps
 * the rest behind "Add details", since a ticket is written as a draft anyway.
 * Creating is real. Once one wins, rewrite it in `work.tsx` and drop this file.
 */
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
  borderVars,
  colorVars,
  focusVars,
  radiusVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { Check, ChevronDown, Plus, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import type { TicketDraft, TicketKind } from '../../preload/bridge.ts';

const VARIANTS = [
  { id: 'form', label: 'A · Form' },
  { id: 'document', label: 'B · Document' },
  { id: 'quick', label: 'C · Quick' },
] as const;
type Variant = (typeof VARIANTS)[number]['id'];

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

export function NewTicketPrototype(props: Props) {
  const { refusal, onCancel, onWrite } = props;
  const [variant, setVariant] = useState<Variant>('document');
  const [kind, setKind] = useState<TicketKind>('feature');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [criteria, setCriteria] = useState<string[]>(['']);
  const [more, setMore] = useState(false);
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
  const shared = { ...props, kind, setKind, title, setTitle, body, setBody, criteria, setCriteria };

  return (
    <Dialog
      isOpen
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
      purpose="form"
      width={variant === 'document' ? 640 : 560}
    >
      <DialogHeader
        title="New ticket"
        subtitle="It starts as a draft. Make it ready when it is clear enough to start."
        onOpenChange={(next) => {
          if (!next && !busy) onCancel();
        }}
      />
      <div {...stylex.props(ui.switch)}>
        <SegmentedControl
          value={variant}
          onChange={(next) => setVariant(next as Variant)}
          label="Prototype variant"
          size="sm"
        >
          {VARIANTS.map((each) => (
            <SegmentedControlItem key={each.id} value={each.id} label={each.label} />
          ))}
        </SegmentedControl>
      </div>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div {...stylex.props(ui.body)} onKeyDown={onKeyDown}>
        {refusal !== null && (
          <Banner status="error" title="Ticket was not created" description={refusal} />
        )}
        {variant === 'form' && <FormVariant {...shared} />}
        {variant === 'document' && <DocumentVariant {...shared} />}
        {variant === 'quick' && <QuickVariant {...shared} more={more} setMore={setMore} />}
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

interface Fields extends Props {
  kind: TicketKind;
  setKind: (kind: TicketKind) => void;
  title: string;
  setTitle: (title: string) => void;
  body: string;
  setBody: (body: string) => void;
  criteria: string[];
  setCriteria: (criteria: string[]) => void;
}

/* ── A. The form, in a dialog ───────────────────────────────────────────── */

function FormVariant({ kinds, kind, setKind, title, setTitle, body, setBody, ...rest }: Fields) {
  return (
    <>
      <section {...stylex.props(ui.group)}>
        <Text type="label" weight="medium">
          What kind of work
        </Text>
        <div>
          <SegmentedControl
            value={kind}
            onChange={(next) => setKind(next as TicketKind)}
            label="What kind of work this is"
            size="sm"
          >
            {kinds.map((each) => (
              <SegmentedControlItem key={each} value={each} label={each} />
            ))}
          </SegmentedControl>
        </div>
        <Text type="supporting" color="secondary">
          {KIND_WORDS[kind]}. The kind can’t change once the ticket is written.
        </Text>
      </section>
      <TextInput label="Title" value={title} onChange={setTitle} />
      <TextArea
        label="Description"
        value={body}
        onChange={setBody}
        description="Markdown works. Everything the agent or a teammate needs to do it."
        rows={5}
      />
      <section {...stylex.props(ui.group)}>
        <Text type="label" weight="medium">
          Done when
        </Text>
        <Criteria criteria={rest.criteria} onChange={rest.setCriteria} />
      </section>
    </>
  );
}

/* ── B. Reads like the document ─────────────────────────────────────────── */

function DocumentVariant({
  kinds,
  kindIcons,
  kind,
  setKind,
  title,
  setTitle,
  body,
  setBody,
  criteria,
  setCriteria,
}: Fields) {
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
        <textarea
          aria-label="Description"
          placeholder="What to build, and why. Markdown works."
          value={body}
          rows={5}
          onChange={(event) => setBody(event.target.value)}
          {...stylex.props(ui.docText)}
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

/* ── C. A kind and a title, the rest on request ─────────────────────────── */

function QuickVariant({
  kinds,
  kindIcons,
  kind,
  setKind,
  title,
  setTitle,
  body,
  setBody,
  criteria,
  setCriteria,
  more,
  setMore,
}: Fields & { more: boolean; setMore: (more: boolean) => void }) {
  return (
    <>
      <div {...stylex.props(ui.chips)} aria-label="What kind of work">
        {kinds.map((each) => (
          <button
            key={each}
            type="button"
            aria-pressed={each === kind}
            title={KIND_WORDS[each]}
            {...stylex.props(ui.chip, each === kind && ui.chipOn)}
            onClick={() => setKind(each)}
          >
            <Icon icon={kindIcons[each]} size="xsm" />
            {each}
          </button>
        ))}
      </div>
      <Text type="supporting" color="secondary">
        {KIND_WORDS[kind]}.
      </Text>
      <TextInput label="Title" value={title} onChange={setTitle} />
      <button
        type="button"
        aria-expanded={more}
        {...stylex.props(ui.more)}
        onClick={() => setMore(!more)}
      >
        <span {...stylex.props(ui.moreChevron, more && ui.moreChevronOpen)}>
          <Icon icon={ChevronDown} size="xsm" />
        </span>
        {more ? 'Hide details' : 'Add details'}
        <span {...stylex.props(ui.docHint)}>description and what done looks like</span>
      </button>
      {more && (
        <>
          <TextArea
            label="Description"
            value={body}
            onChange={setBody}
            description="Markdown works."
            rows={4}
          />
          <section {...stylex.props(ui.group)}>
            <Text type="label" weight="medium">
              Done when
            </Text>
            <Criteria criteria={criteria} onChange={setCriteria} />
          </section>
        </>
      )}
    </>
  );
}

function Criteria({
  criteria,
  onChange,
}: {
  criteria: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <>
      {criteria.map((line, at) => (
        <div key={at} {...stylex.props(ui.criterion)}>
          <div {...stylex.props(ui.grow)}>
            <TextInput
              label={`Criterion ${at + 1}`}
              isLabelHidden
              value={line}
              onChange={(next) => onChange(criteria.map((each, i) => (i === at ? next : each)))}
              size="sm"
            />
          </div>
          <IconButton
            label={`Remove criterion ${at + 1}`}
            icon={<Icon icon={X} size="sm" />}
            isDisabled={criteria.length === 1}
            onClick={() => onChange(criteria.filter((_each, i) => i !== at))}
          />
        </div>
      ))}
      <div>
        <Button
          label="Add criterion"
          icon={<Icon icon={Plus} size="sm" />}
          size="sm"
          variant="ghost"
          onClick={() => onChange([...criteria, ''])}
        />
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
  switch: { paddingBlockEnd: spacingVars['--spacing-3'] },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-4'],
    paddingBlock: spacingVars['--spacing-2'],
  },
  group: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'] },
  grow: { flex: 1, minWidth: 0 },
  criterion: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-2'] },
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
  docText: {
    ...bare,
    resize: 'vertical',
    fontSize: textSizeVars['--font-size-base'],
    lineHeight: 1.5,
    '::placeholder': { color: colorVars['--color-text-secondary'] },
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
  chips: { display: 'flex', flexWrap: 'wrap', gap: spacingVars['--spacing-2'] },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1-5'],
    height: 28,
    paddingInline: spacingVars['--spacing-3'],
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-overlay-hover'] },
    color: colorVars['--color-text-secondary'],
    fontSize: textSizeVars['--font-size-sm'],
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
  },
  chipOn: {
    borderColor: colorVars['--color-accent'],
    backgroundColor: colorVars['--color-neutral'],
    color: colorVars['--color-text-primary'],
  },
  more: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    alignSelf: 'flex-start',
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colorVars['--color-text-primary'],
    fontSize: textSizeVars['--font-size-base'],
    fontWeight: 500,
    cursor: 'pointer',
  },
  moreChevron: {
    display: 'inline-flex',
    color: colorVars['--color-icon-secondary'],
    transform: 'rotate(-90deg)',
    transitionProperty: 'transform',
    transitionDuration: '120ms',
  },
  moreChevronOpen: { transform: 'rotate(0deg)' },
});
