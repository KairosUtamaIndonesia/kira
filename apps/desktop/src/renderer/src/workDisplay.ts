import type { Ticket, TicketKind, TicketStatus } from '../../preload/bridge.ts';
import { copy } from './workCopy.ts';

export type WorkOrder = 'rank' | 'updated' | 'created';
export type WorkGroup = 'status' | 'kind';
export type WorkStatus = TicketStatus | 'blocked';

export interface WorkDisplay {
  search: string;
  status: WorkStatus | 'all';
  kind: TicketKind | 'all';
  owner: 'all' | 'assigned' | 'unassigned';
  order: WorkOrder;
  group: WorkGroup;
  showDone: boolean;
}

export const DEFAULT_WORK_DISPLAY: WorkDisplay = {
  search: '',
  status: 'all',
  kind: 'all',
  owner: 'all',
  order: 'rank',
  group: 'status',
  showDone: false,
};

export function readWorkDisplay(search: string): WorkDisplay {
  const params = new URLSearchParams(search);
  const status = params.get('status');
  const kind = params.get('kind');
  const owner = params.get('owner');
  const order = params.get('order');
  const group = params.get('group');

  return {
    ...DEFAULT_WORK_DISPLAY,
    search: params.get('search') ?? '',
    status: status !== null && isWorkStatus(status) ? status : DEFAULT_WORK_DISPLAY.status,
    kind: kind !== null && isKind(kind) ? kind : DEFAULT_WORK_DISPLAY.kind,
    owner: owner === 'assigned' || owner === 'unassigned' ? owner : DEFAULT_WORK_DISPLAY.owner,
    order: order === 'updated' || order === 'created' ? order : DEFAULT_WORK_DISPLAY.order,
    group: group === 'kind' ? 'kind' : DEFAULT_WORK_DISPLAY.group,
    showDone: params.get('done') === '1',
  };
}

export function canReorderReady(display: WorkDisplay): boolean {
  return (
    display.order === 'rank' &&
    display.search.trim() === '' &&
    display.status === 'all' &&
    display.kind === 'all' &&
    display.owner === 'all'
  );
}

function isKind(value: string): value is TicketKind {
  return [
    'prototype',
    'bug',
    'feature',
    'refactor',
    'question',
    'research',
    'spec',
    'map',
  ].includes(value);
}

function isWorkStatus(value: string): value is WorkStatus {
  return ['draft', 'ready', 'running', 'needs-review', 'blocked', 'done', 'wont-do'].includes(
    value,
  );
}

export type TicketDropPlan =
  | { kind: 'change-status'; status: TicketStatus }
  | { kind: 'add-blocker' }
  | { kind: 'resolve-blockers' };

/**
 * Blocked is derived from open blockers; all other lanes write the stored status.
 */
export function planTicketDrop(ticket: Ticket, target: WorkStatus): TicketDropPlan | null {
  if ((ticket.blocked ? 'blocked' : ticket.status) === target) return null;
  if (target === 'blocked') return { kind: 'add-blocker' };
  if (ticket.blocked) return { kind: 'resolve-blockers' };
  return { kind: 'change-status', status: target };
}

export function displayWork(tickets: Ticket[], display: WorkDisplay): Ticket[] {
  return tickets
    .filter((ticket) => matchesWork(ticket, display))
    .slice()
    .sort((left, right) => compareWork(left, right, display.order));
}

export function matchesWork(ticket: Ticket, display: WorkDisplay): boolean {
  if (!display.showDone && (ticket.status === 'done' || ticket.status === 'wont-do')) return false;
  const status = ticket.blocked ? 'blocked' : ticket.status;
  if (display.status !== 'all' && status !== display.status) return false;
  if (display.kind !== 'all' && ticket.kind !== display.kind) return false;
  if (display.owner === 'assigned' && ticket.assignee === null) return false;
  if (display.owner === 'unassigned' && ticket.assignee !== null) return false;

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
    const key = group === 'status' ? (ticket.blocked ? 'blocked' : ticket.status) : ticket.kind;
    const held = groups.get(key) ?? [];
    held.push(ticket);
    groups.set(key, held);
  }

  return [...groups].map(([key, held]) => ({
    key,
    label: group === 'status' ? copy.statuses[key as WorkStatus].label : key,
    tickets: held,
  }));
}

export function reorderReady(tickets: Ticket[], activeId: string, overId: string): Ticket[] {
  const current = tickets.filter((ticket) => !ticket.blocked && ticket.status === 'ready');
  const activeIndex = current.findIndex((ticket) => ticket.id === activeId);
  const overIndex = current.findIndex((ticket) => ticket.id === overId);
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return current;

  const moved = [...current];
  const [active] = moved.splice(activeIndex, 1);
  if (active === undefined) return current;
  moved.splice(overIndex, 0, active);
  return moved.map((ticket, index) => ({ ...ticket, rank: index }));
}

export function statusLabel(status: WorkStatus): string {
  return copy.statuses[status].label;
}
