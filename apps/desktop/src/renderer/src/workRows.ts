import { CircleAlert, CircleCheck, CircleDashed, CircleHelp, Clock, Play } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Ticket, TicketStatus } from '../../preload/bridge.ts';
import { copy } from './workCopy.ts';

export type DisplayStatus = TicketStatus | 'blocked';

export function statusOf(ticket: Ticket): DisplayStatus {
  return ticket.blocked ? 'blocked' : ticket.status;
}

export function statusIcon(status: DisplayStatus): LucideIcon {
  if (status === 'done') return CircleCheck;
  if (status === 'wont-do') return CircleAlert;
  if (status === 'needs-review') return CircleHelp;
  if (status === 'ready') return Play;
  if (status === 'blocked') return Clock;
  return CircleDashed;
}

export function holding(ticket: Ticket): { icon: LucideIcon; words: string } {
  const status = statusOf(ticket);
  return { icon: statusIcon(status), words: copy.statusWord[status] };
}

export function inStatus(tickets: Ticket[], status: DisplayStatus): Ticket[] {
  return tickets.filter((ticket) => statusOf(ticket) === status);
}

export function isUnbrokenSpec(ticket: Ticket): boolean {
  return ticket.kind === 'spec' && ticket.children.length === 0;
}

export function firstIn(tickets: Ticket[], status: DisplayStatus | 'all'): Ticket | undefined {
  return status === 'all' ? tickets[0] : inStatus(tickets, status)[0];
}

export function when(iso: string, now: number = Date.now()): string {
  const at = new Date(iso);
  const minutes = Math.floor((now - at.getTime()) / 60000);
  if (minutes < 1) return copy.time.now;
  if (minutes < 60) return copy.time.minutesAgo(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return copy.time.hoursAgo(hours);
  return at.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function age(iso: string, now: number = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function byName(tickets: Ticket[], said: string): Ticket | undefined {
  const wanted = said.trim().toUpperCase();
  return wanted === '' ? undefined : tickets.find((ticket) => ticket.name.toUpperCase() === wanted);
}

export function suggestPrefix(name: string): string {
  const letters = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
  if (letters === '') return 'PROJ';
  const started = /^[A-Z]/.test(letters) ? letters : `F${letters}`.slice(0, 6);
  return started.length >= 2 ? started : `${started}X`;
}
