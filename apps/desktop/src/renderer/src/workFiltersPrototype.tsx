/**
 * PROTOTYPE — throwaway. Three ways to search, filter, and arrange Work, switchable from a
 * development-only bar. Every variant drives the real display state, so filtering works.
 *
 * Question it answers: filters used to be buttons that cycled their value on each click,
 * hidden behind a toggle, with how the list is arranged mixed in among what it shows. Each
 * variant separates the two — Filter narrows which tickets show; Display says how they are
 * grouped and ordered — and differs in where the filters live.
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
  shadowVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, ListFilter, Search, SlidersHorizontal, X } from 'lucide-react';
import { useRef } from 'react';
import type { Band, Ticket, TicketKind } from '../../preload/bridge.ts';
import {
  DEFAULT_WORK_DISPLAY,
  displayWork,
  type WorkClaimFilter,
  type WorkDisplay,
  type WorkOrder,
} from './workDisplay.ts';

export const FILTER_VARIANTS = [
  { id: 'menu', label: 'Filter menu + chips' },
  { id: 'inline', label: 'Inline dropdowns' },
  { id: 'tabs', label: 'Status tabs' },
] as const;
export type FilterVariant = (typeof FILTER_VARIANTS)[number]['id'];

type Lane = { id: Band; label: string };

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

const CLAIM_WORDS: Record<WorkClaimFilter, string> = {
  all: 'Anyone or no one',
  claimed: 'Being worked on',
  unclaimed: 'Not being worked on',
};

const ORDER_WORDS: Record<WorkOrder, string> = {
  rank: 'Priority',
  updated: 'Last updated',
  created: 'Newest first',
};

export interface FilterProps {
  variant: FilterVariant;
  display: WorkDisplay;
  onChange: (update: (current: WorkDisplay) => WorkDisplay) => void;
  tickets: Ticket[];
  lanes: Lane[];
  isDisabled: boolean;
}

/** Everything that narrows which tickets show; Display's settings do not count. */
function activeFilters(display: WorkDisplay, lanes: Lane[]) {
  const active: { key: string; label: string; clear: (d: WorkDisplay) => WorkDisplay }[] = [];
  if (display.band !== 'all') {
    active.push({
      key: 'band',
      label: `Status: ${lanes.find((each) => each.id === display.band)?.label ?? display.band}`,
      clear: (d) => ({ ...d, band: 'all' }),
    });
  }
  if (display.kind !== 'all') {
    active.push({
      key: 'kind',
      label: `Kind: ${display.kind}`,
      clear: (d) => ({ ...d, kind: 'all' }),
    });
  }
  if (display.claim !== 'all') {
    active.push({
      key: 'claim',
      label: CLAIM_WORDS[display.claim],
      clear: (d) => ({ ...d, claim: 'all' }),
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
      label: 'Any status',
      endContent: check(display.band === 'all'),
      onClick: () => onChange((d) => ({ ...d, band: 'all' })),
    },
    ...lanes.map((lane) => ({
      label: lane.label,
      endContent:
        display.band === lane.id ? (
          check(true)
        ) : (
          <span {...stylex.props(ui.menuCount)}>{counts.get(lane.id) ?? 0}</span>
        ),
      onClick: () => onChange((d) => ({ ...d, band: lane.id })),
    })),
  ];
}

function kindItems(props: FilterProps): DropdownMenuOption[] {
  const { display, onChange } = props;
  return [
    {
      label: 'Any kind',
      endContent: check(display.kind === 'all'),
      onClick: () => onChange((d) => ({ ...d, kind: 'all' })),
    },
    ...KINDS.map((kind) => ({
      label: kind,
      endContent: check(display.kind === kind),
      onClick: () => onChange((d) => ({ ...d, kind })),
    })),
  ];
}

function claimItems(props: FilterProps): DropdownMenuOption[] {
  const { display, onChange } = props;
  return (['all', 'claimed', 'unclaimed'] as const).map((claim) => ({
    label: CLAIM_WORDS[claim],
    endContent: check(display.claim === claim),
    onClick: () => onChange((d) => ({ ...d, claim })),
  }));
}

function displayItems(props: FilterProps): DropdownMenuOption[] {
  const { display, onChange } = props;
  return [
    {
      type: 'section',
      title: 'Group by',
      items: (['status', 'kind'] as const).map((group) => ({
        label: group === 'status' ? 'Status' : 'Kind',
        endContent: check(display.group === group),
        onClick: () => onChange((d) => ({ ...d, group })),
      })),
    },
    {
      type: 'section',
      title: 'Order by',
      items: (['rank', 'updated', 'created'] as const).map((order) => ({
        label: ORDER_WORDS[order],
        endContent: check(display.order === order),
        onClick: () => onChange((d) => ({ ...d, order })),
      })),
    },
    { type: 'divider' },
    {
      label: 'Show done tickets',
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
        label="Search tickets"
        isLabelHidden
        size="sm"
        width={220}
        value={display.search}
        placeholder="Search tickets"
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
        label: 'Display',
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
  for (const ticket of displayWork(props.tickets, { ...props.display, band: 'all' })) {
    counts.set(ticket.band, (counts.get(ticket.band) ?? 0) + 1);
  }

  if (props.variant === 'menu') {
    return (
      <>
        <SearchField {...props} />
        <DropdownMenu
          button={{
            label: active.length === 0 ? 'Filter' : `Filter · ${active.length}`,
            icon: <Icon icon={ListFilter} size="sm" />,
            size: 'sm',
            variant: active.length === 0 ? 'ghost' : 'secondary',
          }}
          alignment="end"
          menuWidth={240}
          items={[
            { label: 'Status', items: statusItems(props, counts) },
            { label: 'Kind', items: kindItems(props) },
            { label: 'Being worked on', items: claimItems(props) },
          ]}
        />
        <DisplayMenu {...props} />
      </>
    );
  }

  if (props.variant === 'inline') {
    const { display } = props;
    return (
      <>
        <SearchField {...props} />
        <span {...stylex.props(ui.inlineGroup)}>
          <DropdownMenu
            button={{
              label: `Status: ${display.band === 'all' ? 'Any' : props.lanes.find((l) => l.id === display.band)?.label}`,
              size: 'sm',
              variant: display.band === 'all' ? 'ghost' : 'secondary',
            }}
            hasChevron
            menuWidth={220}
            items={statusItems(props, counts)}
          />
          <DropdownMenu
            button={{
              label: `Kind: ${display.kind === 'all' ? 'Any' : display.kind}`,
              size: 'sm',
              variant: display.kind === 'all' ? 'ghost' : 'secondary',
            }}
            hasChevron
            menuWidth={180}
            items={kindItems(props)}
          />
          <DropdownMenu
            button={{
              label:
                display.claim === 'all'
                  ? 'Working: Any'
                  : display.claim === 'claimed'
                    ? 'Working: Yes'
                    : 'Working: No',
              size: 'sm',
              variant: display.claim === 'all' ? 'ghost' : 'secondary',
            }}
            hasChevron
            menuWidth={220}
            items={claimItems(props)}
          />
        </span>
        <DisplayMenu {...props} />
      </>
    );
  }

  return (
    <>
      <SearchField {...props} />
      <DisplayMenu {...props} />
    </>
  );
}

/* ── The part under the header ──────────────────────────────────────────── */

export function FilterBar(props: FilterProps & { shown: number; total: number }) {
  const { variant, display, onChange, lanes, shown, total } = props;
  const active = activeFilters(display, lanes);

  if (variant === 'menu') {
    if (active.length === 0 && display.search === '') return null;
    return (
      <div {...stylex.props(ui.bar)}>
        {active.map((each) => (
          <span key={each.key} {...stylex.props(ui.chip)}>
            {each.label}
            <button
              type="button"
              aria-label={`Remove filter ${each.label}`}
              {...stylex.props(ui.chipX)}
              onClick={() => onChange(each.clear)}
            >
              <Icon icon={X} size="xsm" />
            </button>
          </span>
        ))}
        {active.length > 0 && (
          <Button
            label="Clear filters"
            size="sm"
            variant="ghost"
            onClick={() =>
              onChange((d) => ({ ...d, band: 'all', kind: 'all', claim: 'all', search: '' }))
            }
          />
        )}
        <span {...stylex.props(ui.count)}>
          {shown} of {total} tickets
        </span>
      </div>
    );
  }

  if (variant === 'inline') {
    if (active.length === 0 && display.search === '') return null;
    return (
      <div {...stylex.props(ui.bar)}>
        <span {...stylex.props(ui.count)}>
          {shown} of {total} tickets
        </span>
        <span {...stylex.props(ui.edgeEnd)}>
          <Button
            label="Clear filters"
            size="sm"
            variant="ghost"
            onClick={() =>
              onChange((d) => ({ ...d, band: 'all', kind: 'all', claim: 'all', search: '' }))
            }
          />
        </span>
      </div>
    );
  }

  // Status tabs: status is the one filter people change most, so it is always in view.
  const counts = new Map<string, number>();
  const base = displayWork(props.tickets, { ...display, band: 'all', showDone: true });
  for (const ticket of base) counts.set(ticket.band, (counts.get(ticket.band) ?? 0) + 1);
  const tabs: { id: Band | 'all'; label: string; count: number }[] = [
    {
      id: 'all',
      label: 'All',
      count: base.filter((t) => t.band !== 'done' || display.showDone).length,
    },
    ...lanes.map((lane) => ({ id: lane.id, label: lane.label, count: counts.get(lane.id) ?? 0 })),
  ];
  return (
    <div {...stylex.props(ui.tabBar)}>
      <div role="tablist" aria-label="Status" {...stylex.props(ui.tabs)}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={display.band === tab.id}
            {...stylex.props(ui.tab, display.band === tab.id && ui.tabOn)}
            onClick={() =>
              onChange((d) => ({
                ...d,
                band: tab.id,
                showDone: tab.id === 'done' ? true : d.showDone,
              }))
            }
          >
            {tab.label}
            <span {...stylex.props(ui.tabCount)}>{tab.count}</span>
          </button>
        ))}
      </div>
      <span {...stylex.props(ui.tabTools)}>
        <DropdownMenu
          button={{
            label: display.kind === 'all' ? 'Kind' : `Kind: ${display.kind}`,
            size: 'sm',
            variant: display.kind === 'all' ? 'ghost' : 'secondary',
          }}
          hasChevron
          alignment="end"
          menuWidth={180}
          items={kindItems(props)}
        />
        <DropdownMenu
          button={{
            label:
              display.claim === 'all'
                ? 'Being worked on'
                : display.claim === 'claimed'
                  ? 'Being worked on: yes'
                  : 'Being worked on: no',
            size: 'sm',
            variant: display.claim === 'all' ? 'ghost' : 'secondary',
          }}
          hasChevron
          alignment="end"
          menuWidth={220}
          items={claimItems(props)}
        />
      </span>
    </div>
  );
}

export function FilterSwitcher({
  variant,
  onChange,
}: {
  variant: FilterVariant;
  onChange: (next: FilterVariant) => void;
}) {
  return (
    <div {...stylex.props(ui.switcher)} role="toolbar" aria-label="Filter prototypes">
      {FILTER_VARIANTS.map((each, index) => (
        <button
          key={each.id}
          type="button"
          aria-pressed={each.id === variant}
          {...stylex.props(ui.segment, each.id === variant && ui.segmentOn)}
          onClick={() => onChange(each.id)}
        >
          {String.fromCharCode(65 + index)} · {each.label}
        </button>
      ))}
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
  inlineGroup: { display: 'inline-flex', alignItems: 'center', gap: spacingVars['--spacing-1'] },
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
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-3'],
    minHeight: 44,
    paddingInline: spacingVars['--spacing-4'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  tabs: {
    display: 'flex',
    alignItems: 'stretch',
    gap: spacingVars['--spacing-4'],
    alignSelf: 'stretch',
    minWidth: 0,
    overflowX: 'auto',
  },
  tab: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1-5'],
    padding: 0,
    borderWidth: 0,
    borderBlockEndWidth: 2,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: 'transparent',
    backgroundColor: 'transparent',
    color: {
      default: colorVars['--color-text-secondary'],
      ':hover': colorVars['--color-text-primary'],
    },
    fontSize: textSizeVars['--font-size-base'],
    fontWeight: 500,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
    outlineOffset: -2,
  },
  tabOn: {
    color: colorVars['--color-text-primary'],
    borderBlockEndColor: colorVars['--color-accent'],
  },
  tabCount: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
  tabTools: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1'],
    marginInlineStart: 'auto',
    // Ghost buttons at the row's end line their text up with its padding (desktop-conventions).
    marginInlineEnd: `calc(-1 * ${spacingVars['--spacing-3']})`,
    flexShrink: 0,
  },
  edgeEnd: {
    display: 'inline-flex',
    marginInlineEnd: `calc(-1 * ${spacingVars['--spacing-3']})`,
  },
  switcher: {
    position: 'fixed',
    insetBlockEnd: 16,
    insetInlineStart: '50%',
    transform: 'translateX(-50%)',
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: spacingVars['--spacing-1'],
    borderRadius: 999,
    backgroundColor: colorVars['--color-background-inverted'],
    color: colorVars['--color-background-surface'],
    boxShadow: shadowVars['--shadow-high'],
    fontSize: textSizeVars['--font-size-sm'],
  },
  segment: {
    height: 24,
    paddingInline: spacingVars['--spacing-2'],
    borderWidth: 0,
    borderRadius: 999,
    backgroundColor: { default: 'transparent', ':hover': 'rgb(128 128 128 / 0.25)' },
    color: 'inherit',
    fontSize: textSizeVars['--font-size-sm'],
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },
  segmentOn: {
    backgroundColor: {
      default: colorVars['--color-accent'],
      ':hover': colorVars['--color-accent'],
    },
    color: colorVars['--color-on-accent'],
  },
});
