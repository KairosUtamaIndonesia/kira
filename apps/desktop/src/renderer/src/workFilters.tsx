/**
 * Search, filter, and arrange Work. Filter narrows which tickets show (Status, Kind, Owner);
 * Display says how they are grouped and ordered. Active filters sit under the header as
 * removable chips, and the row only exists while something is filtered.
 */
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu, type DropdownMenuOption } from '@astryxdesign/core/DropdownMenu';
import { Icon } from '@astryxdesign/core/Icon';
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
import { Check, ListFilter, Search, SlidersHorizontal, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useRef } from 'react';
import type { Ticket, TicketKind } from '../../preload/bridge.ts';
import { DEFAULT_WORK_DISPLAY, displayWork, type WorkDisplay } from './workDisplay.ts';
import type { WorkStatus } from './workDisplay.ts';
import { statusOf } from './workRows.ts';
import { copy } from './workCopy.ts';

type Lane = { id: WorkStatus; label: string };

const KINDS: TicketKind[] = [
  'feature',
  'bug',
  'refactor',
  'prototype',
  'question',
  'research',
  'spec',
  'map',
];

export interface FilterProps {
  kindIcons: Record<TicketKind, LucideIcon>;
  display: WorkDisplay;
  onChange: (update: (current: WorkDisplay) => WorkDisplay) => void;
  tickets: Ticket[];
  lanes: Lane[];
  isDisabled: boolean;
}

/** Everything that narrows which tickets show; Display's settings do not count. */
function activeFilters(display: WorkDisplay, lanes: Lane[]) {
  const active: { key: string; label: string; clear: (d: WorkDisplay) => WorkDisplay }[] = [];
  if (display.status !== 'all') {
    active.push({
      key: 'status',
      label: copy.filter.statusChip(
        lanes.find((each) => each.id === display.status)?.label ?? display.status,
      ),
      clear: (d) => ({ ...d, status: 'all' }),
    });
  }
  if (display.kind !== 'all') {
    active.push({
      key: 'kind',
      label: copy.filter.kindChip(display.kind),
      clear: (d) => ({ ...d, kind: 'all' }),
    });
  }
  if (display.owner !== 'all') {
    active.push({
      key: 'owner',
      label: copy.filter.owners[display.owner],
      clear: (d) => ({ ...d, owner: 'all' }),
    });
  }
  return active;
}

function check(isOn: boolean) {
  return isOn ? <Icon icon={Check} size="sm" /> : undefined;
}

function statusItems(props: FilterProps, counts: Map<string, number>): DropdownMenuOption[] {
  const { display, onChange, lanes } = props;
  return [
    {
      label: copy.filter.anyStatus,
      endContent: check(display.status === 'all'),
      onClick: () => onChange((d) => ({ ...d, status: 'all' })),
    },
    ...lanes.map((lane) => ({
      label: lane.label,
      endContent:
        display.status === lane.id ? (
          check(true)
        ) : (
          <span {...stylex.props(ui.menuCount)}>{counts.get(lane.id) ?? 0}</span>
        ),
      onClick: () => onChange((d) => ({ ...d, status: lane.id })),
    })),
  ];
}

function kindItems(props: FilterProps): DropdownMenuOption[] {
  const { display, onChange } = props;
  return [
    {
      label: copy.filter.anyKind,
      endContent: check(display.kind === 'all'),
      onClick: () => onChange((d) => ({ ...d, kind: 'all' })),
    },
    ...KINDS.map((kind) => ({
      label: kind,
      icon: <Icon icon={props.kindIcons[kind]} size="sm" />,
      endContent: check(display.kind === kind),
      onClick: () => onChange((d) => ({ ...d, kind })),
    })),
  ];
}

function ownerItems(props: FilterProps): DropdownMenuOption[] {
  const { display, onChange } = props;
  return (['all', 'assigned', 'unassigned'] as const).map((owner) => ({
    label: copy.filter.owners[owner],
    endContent: check(display.owner === owner),
    onClick: () => onChange((d) => ({ ...d, owner })),
  }));
}

function displayItems(props: FilterProps): DropdownMenuOption[] {
  const { display, onChange } = props;
  return [
    {
      type: 'section',
      title: copy.display.groupBy,
      items: (['status', 'kind'] as const).map((group) => ({
        label: copy.display.groups[group],
        endContent: check(display.group === group),
        onClick: () => onChange((d) => ({ ...d, group })),
      })),
    },
    {
      type: 'section',
      title: copy.display.orderBy,
      items: (['rank', 'updated', 'created'] as const).map((order) => ({
        label: copy.display.orders[order],
        endContent: check(display.order === order),
        onClick: () => onChange((d) => ({ ...d, order })),
      })),
    },
    { type: 'divider' },
    {
      label: copy.display.showDone,
      endContent: check(display.showDone),
      onClick: () => onChange((d) => ({ ...d, showDone: !d.showDone })),
    },
  ];
}

/** Search: an icon, a clear button, and "/" from anywhere on the page to jump into it. */
function SearchField({ display, onChange, isDisabled }: FilterProps) {
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <span
      {...stylex.props(ui.search)}
      ref={(node) => {
        if (node === null) return;
        const onKey = (event: KeyboardEvent): void => {
          const target = event.target as HTMLElement | null;
          if (
            event.key !== '/' ||
            target?.closest('input, textarea, [contenteditable="true"]') !== null
          ) {
            return;
          }
          event.preventDefault();
          input.current?.focus();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }}
    >
      <TextInput
        ref={input}
        label={copy.search.label}
        isLabelHidden
        size="sm"
        width={220}
        value={display.search}
        placeholder={copy.search.placeholder}
        startIcon={Search}
        hasClear
        isDisabled={isDisabled}
        onChange={(search) => onChange((d) => ({ ...d, search }))}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onChange((d) => ({ ...d, search: '' }));
            (event.target as HTMLInputElement).blur();
          }
        }}
      />
      {display.search === '' && (
        <kbd {...stylex.props(ui.kbd)} aria-hidden>
          /
        </kbd>
      )}
    </span>
  );
}

/** The menu that arranges the view, the same in every variant. */
function DisplayMenu(props: FilterProps) {
  const arranged =
    props.display.group !== DEFAULT_WORK_DISPLAY.group ||
    props.display.order !== DEFAULT_WORK_DISPLAY.order ||
    props.display.showDone !== DEFAULT_WORK_DISPLAY.showDone;
  return (
    <DropdownMenu
      button={{
        label: copy.display.button,
        icon: <Icon icon={SlidersHorizontal} size="sm" />,
        size: 'sm',
        variant: arranged ? 'secondary' : 'ghost',
      }}
      alignment="end"
      menuWidth={220}
      items={displayItems(props)}
    />
  );
}

/* ── The part in the header ─────────────────────────────────────────────── */

export function FilterToolbar(props: FilterProps) {
  const active = activeFilters(props.display, props.lanes);
  const counts = new Map<string, number>();
  for (const ticket of displayWork(props.tickets, { ...props.display, status: 'all' })) {
    const status = statusOf(ticket);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  return (
    <>
      <SearchField {...props} />
      <DropdownMenu
        button={{
          label: copy.filter.button(active.length),
          icon: <Icon icon={ListFilter} size="sm" />,
          size: 'sm',
          variant: active.length === 0 ? 'ghost' : 'secondary',
        }}
        alignment="end"
        menuWidth={240}
        items={[
          { label: copy.filter.status, items: statusItems(props, counts) },
          { label: copy.filter.kind, items: kindItems(props) },
          { label: copy.filter.owner, items: ownerItems(props) },
        ]}
      />
      <DisplayMenu {...props} />
    </>
  );
}

/* ── The part under the header ──────────────────────────────────────────── */

export function FilterBar(
  props: Pick<FilterProps, 'display' | 'onChange' | 'lanes'> & { shown: number; total: number },
) {
  const { display, onChange, lanes, shown, total } = props;
  const active = activeFilters(display, lanes);

  if (active.length === 0 && display.search === '') return null;
  return (
    <div {...stylex.props(ui.bar)}>
      {active.map((each) => (
        <span key={each.key} {...stylex.props(ui.chip)}>
          {each.label}
          <button
            type="button"
            aria-label={copy.filter.remove(each.label)}
            {...stylex.props(ui.chipX)}
            onClick={() => onChange(each.clear)}
          >
            <Icon icon={X} size="xsm" />
          </button>
        </span>
      ))}
      {active.length > 0 && (
        <Button
          label={copy.filter.clear}
          size="sm"
          variant="ghost"
          onClick={() =>
            onChange((d) => ({ ...d, status: 'all', kind: 'all', owner: 'all', search: '' }))
          }
        />
      )}
      <span {...stylex.props(ui.count)}>{copy.filter.shown(shown, total)}</span>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

const ui = stylex.create({
  search: { position: 'relative', display: 'inline-flex', alignItems: 'center' },
  kbd: {
    position: 'absolute',
    insetInlineEnd: 8,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 18,
    height: 18,
    paddingInline: 4,
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border-emphasized'],
    borderRadius: radiusVars['--radius-inner'],
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-xs'],
    color: colorVars['--color-text-secondary'],
    pointerEvents: 'none',
  },
  menuCount: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
  bar: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacingVars['--spacing-2'],
    minHeight: 44,
    paddingInline: spacingVars['--spacing-4'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    height: 24,
    paddingInlineStart: spacingVars['--spacing-2'],
    paddingInlineEnd: 2,
    borderRadius: radiusVars['--radius-element'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-primary'],
    backgroundColor: colorVars['--color-neutral'],
  },
  chipX: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    padding: 0,
    borderWidth: 0,
    borderRadius: radiusVars['--radius-inner'],
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-overlay-hover'] },
    color: colorVars['--color-icon-secondary'],
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
  },
  count: {
    marginInlineStart: 'auto',
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
});
