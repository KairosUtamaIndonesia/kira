import type { Band, Ticket, TicketKind } from '../../preload/bridge.ts';

export type WorkOrder = 'rank' | 'updated' | 'created';
export type WorkGroup = 'status' | 'kind';
export type WorkClaimFilter = 'all' | 'claimed' | 'unclaimed';

export interface WorkDisplay {
  search: string;
  band: Band | 'all';
  kind: TicketKind | 'all';
  claim: WorkClaimFilter;
  order: WorkOrder;
  group: WorkGroup;
  showDone: boolean;
}

export const DEFAULT_WORK_DISPLAY: WorkDisplay = {
  search: '',
  band: 'all',
  kind: 'all',
  claim: 'all',
  order: 'rank',
  group: 'status',
  showDone: false,
};

const BAND_LABELS: Record<Band, string> = {
  draft: 'Drafts',
  ready: 'Ready',
  blocked: 'Blocked',
  running: 'Running',
  'needs-you': 'Needs review',
  done: 'Done',
};

export function displayWork(tickets: Ticket[], display: WorkDisplay): Ticket[] {
  return tickets
    .filter((ticket) => matchesWork(ticket, display))
    .slice()
    .sort((left, right) => compareWork(left, right, display.order));
}

export function matchesWork(ticket: Ticket, display: WorkDisplay): boolean {
  if (!display.showDone && ticket.band === 'done') return false;
  if (display.band !== 'all' && ticket.band !== display.band) return false;
  if (display.kind !== 'all' && ticket.kind !== display.kind) return false;
  if (display.claim === 'claimed' && ticket.claim === null) return false;
  if (display.claim === 'unclaimed' && ticket.claim !== null) return false;

  const search = display.search.trim().toLocaleLowerCase();
  if (search === '') return true;

  const words = [ticket.name, ticket.title, ticket.body, ...ticket.criteria]
    .join('\n')
    .toLocaleLowerCase();
  return words.includes(search);
}

export function compareWork(left: Ticket, right: Ticket, order: WorkOrder): number {
  if (order === 'rank') return left.rank - right.rank || left.number - right.number;

  const leftTime = Date.parse(order === 'updated' ? left.updatedAt : left.createdAt);
  const rightTime = Date.parse(order === 'updated' ? right.updatedAt : right.createdAt);
  return rightTime - leftTime || left.number - right.number;
}

export function groupedWork(
  tickets: Ticket[],
  group: WorkGroup,
): { key: string; label: string; tickets: Ticket[] }[] {
  const groups = new Map<string, Ticket[]>();

  for (const ticket of tickets) {
    const key = group === 'status' ? ticket.band : ticket.kind;
    const held = groups.get(key) ?? [];
    held.push(ticket);
    groups.set(key, held);
  }

  return [...groups].map(([key, held]) => ({
    key,
    label: group === 'status' ? BAND_LABELS[key as Band] : key,
    tickets: held,
  }));
}

export function reorderReady(tickets: Ticket[], activeId: string, overId: string): Ticket[] {
  const current = tickets.filter((ticket) => ticket.band === 'ready');
  const activeIndex = current.findIndex((ticket) => ticket.id === activeId);
  const overIndex = current.findIndex((ticket) => ticket.id === overId);
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return current;

  const moved = [...current];
  const [active] = moved.splice(activeIndex, 1);
  if (active === undefined) return current;
  moved.splice(overIndex, 0, active);
  return moved.map((ticket, index) => ({ ...ticket, rank: index }));
}

export function bandLabel(band: Band): string {
  return BAND_LABELS[band];
}
