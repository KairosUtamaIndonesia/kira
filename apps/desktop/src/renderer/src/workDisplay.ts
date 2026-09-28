import type { Band, Gate, Ticket, TicketKind } from '../../preload/bridge.ts';

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

export function readWorkDisplay(search: string): WorkDisplay {
  const params = new URLSearchParams(search);
  const band = params.get('band');
  const kind = params.get('kind');
  const claim = params.get('claim');
  const order = params.get('order');
  const group = params.get('group');

  return {
    ...DEFAULT_WORK_DISPLAY,
    search: params.get('search') ?? '',
    band: band !== null && isBand(band) ? band : DEFAULT_WORK_DISPLAY.band,
    kind: kind !== null && isKind(kind) ? kind : DEFAULT_WORK_DISPLAY.kind,
    claim: claim === 'claimed' || claim === 'unclaimed' ? claim : DEFAULT_WORK_DISPLAY.claim,
    order: order === 'updated' || order === 'created' ? order : DEFAULT_WORK_DISPLAY.order,
    group: group === 'kind' ? 'kind' : DEFAULT_WORK_DISPLAY.group,
    showDone: params.get('done') === '1',
  };
}

export function canReorderReady(display: WorkDisplay): boolean {
  return (
    display.order === 'rank' &&
    display.search.trim() === '' &&
    display.band === 'all' &&
    display.kind === 'all' &&
    display.claim === 'all'
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

function isBand(value: string): value is Band {
  return ['draft', 'ready', 'blocked', 'running', 'needs-you', 'done'].includes(value);
}

const BAND_LABELS: Record<Band, string> = {
  draft: 'Drafts',
  ready: 'Ready',
  blocked: 'Blocked',
  running: 'Running',
  'needs-you': 'Needs review',
  done: 'Done',
};

export type TicketDropPlan =
  | { kind: 'choose-ready-gate' }
  | { kind: 'change-gate'; gate: Gate }
  | { kind: 'prepare-agent-run' }
  | { kind: 'start-run' }
  | { kind: 'add-blocker' }
  | { kind: 'resolve-blockers' }
  | { kind: 'send-back' }
  | { kind: 'accept-result' }
  | { kind: 'choose-closure' }
  | { kind: 'unavailable'; reason: string };

/**
 * A lane drop is an intent for a supported ticket action, never a band write.
 * The server's next queue read remains the only authority on where the ticket lands.
 */
export function planTicketDrop(ticket: Ticket, target: Band): TicketDropPlan | null {
  if (ticket.band === target) return null;
  if (ticket.closedAt !== null || ticket.band === 'done') {
    return { kind: 'unavailable', reason: 'Closed tickets cannot be reopened from the board.' };
  }
  if (ticket.claim !== null || ticket.band === 'running') {
    return { kind: 'unavailable', reason: 'A ticket with an active run cannot be moved by hand.' };
  }

  if (ticket.band === 'needs-you') {
    const proposal = ticket.runs[0];
    if (
      proposal?.endedAt === null ||
      proposal?.endedAt === undefined ||
      proposal.verdict !== null
    ) {
      return {
        kind: 'unavailable',
        reason: 'This ticket is waiting on a person, but has no run proposal to answer here.',
      };
    }
    if (target === 'ready') return { kind: 'send-back' };
    if (target === 'done') return { kind: 'accept-result' };
    return {
      kind: 'unavailable',
      reason: 'Answer the run proposal before moving this ticket to another lane.',
    };
  }

  if (target === 'needs-you') {
    return {
      kind: 'unavailable',
      reason: 'Needs review is created by a real question or run result, not a board action.',
    };
  }

  if (target === 'draft') return { kind: 'change-gate', gate: 'draft' };

  if (target === 'ready') {
    if (ticket.band === 'draft') {
      return ticket.kind === 'map'
        ? { kind: 'unavailable', reason: 'A map moves to review when its children have outcomes.' }
        : { kind: 'choose-ready-gate' };
    }
    if (ticket.band === 'blocked') {
      if (ticket.kind === 'map') {
        return {
          kind: 'unavailable',
          reason: 'A map moves to review after its children have approved outcomes.',
        };
      }
      if (!ticket.children.some((child) => !child.closed)) {
        return {
          kind: 'unavailable',
          reason: 'This ticket is blocked by a rule that cannot be changed from the board.',
        };
      }
      return { kind: 'resolve-blockers' };
    }
  }

  if (target === 'running') {
    if (ticket.kind === 'map') {
      return { kind: 'unavailable', reason: 'Maps coordinate work; they do not run as tickets.' };
    }
    if (ticket.band === 'draft' || ticket.gate === 'ready-for-human') {
      return ticket.criteria.some((criterion) => criterion.trim() !== '')
        ? { kind: 'prepare-agent-run' }
        : {
            kind: 'unavailable',
            reason: 'Add acceptance criteria before making this ticket ready for an agent.',
          };
    }
    if (ticket.band === 'ready' && ticket.gate === 'ready-for-agent') {
      return ticket.criteria.some((criterion) => criterion.trim() !== '')
        ? { kind: 'start-run' }
        : {
            kind: 'unavailable',
            reason: 'Add acceptance criteria before starting an agent run.',
          };
    }
    return {
      kind: 'unavailable',
      reason: 'This ticket must be ready for an agent before a run can start.',
    };
  }

  if (target === 'blocked') {
    if (ticket.band !== 'ready') {
      return {
        kind: 'unavailable',
        reason: 'Only ready tickets can add a blocker from the board.',
      };
    }
    return { kind: 'add-blocker' };
  }

  if (target === 'done') {
    if (ticket.kind === 'map') {
      return {
        kind: 'unavailable',
        reason: 'A map closes only when its destination spec is approved.',
      };
    }
    if ((ticket.kind === 'question' || ticket.kind === 'research') && ticket.outcome == null) {
      return {
        kind: 'unavailable',
        reason: 'Approve this ticket’s outcome before closing it.',
      };
    }
    return { kind: 'choose-closure' };
  }

  return { kind: 'unavailable', reason: 'That lane has no supported action for this ticket.' };
}

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
