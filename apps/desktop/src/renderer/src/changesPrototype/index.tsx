/**
 * PROTOTYPE — throwaway. Sub-shape A: the variants render inside the real
 * workbench tab, beside the real chat, gated by `?variant=`.
 *
 *   Three variants of the Changes view, switchable with ←/→ or the bar:
 *     now  the view as it ships
 *     A    Ledger        — ruled sections, the diff opens in the row
 *     B    Review        — a list, then a full-pane diff you step through
 *     C    Commit first  — the commit is the page; a checkbox is staging
 *
 * Dev builds only. Production renders the real view and never mounts the bar.
 */
import * as stylex from '@stylexjs/stylex';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type ReactNode, useEffect, useSyncExternalStore } from 'react';
import { CommitFirst } from './commitFirst';
import { Ledger } from './ledger';
import { Review } from './review';

const VARIANTS = [
  { key: 'now', name: 'Current' },
  { key: 'A', name: 'Ledger' },
  { key: 'B', name: 'Review' },
  { key: 'C', name: 'Commit first' },
] as const;

type Key = (typeof VARIANTS)[number]['key'];

const listeners = new Set<() => void>();

function readKey(): Key {
  const wanted = new URLSearchParams(window.location.search).get('variant');

  return VARIANTS.find((each) => each.key === wanted)?.key ?? 'now';
}

function choose(key: Key): void {
  const url = new URL(window.location.href);
  url.searchParams.set('variant', key);
  window.history.replaceState(null, '', url);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

function step(from: Key, by: number): Key {
  const at = VARIANTS.findIndex((each) => each.key === from);

  return VARIANTS[(at + by + VARIANTS.length) % VARIANTS.length]!.key;
}

const styles = stylex.create({
  bar: {
    position: 'fixed',
    insetInline: 0,
    insetBlockStart: 6,
    zIndex: 1000,
    marginInline: 'auto',
    width: 'fit-content',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    paddingBlock: 4,
    paddingInline: 8,
    borderRadius: 9999,
    color: '#fff',
    backgroundColor: '#111',
    boxShadow: '0 0 0 1px rgba(255,255,255,0.28), 0 8px 24px rgba(0,0,0,0.35)',
    fontSize: 13,
    fontWeight: 600,
  },
  arrow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    padding: 0,
    borderWidth: 0,
    borderRadius: 9999,
    color: '#fff',
    backgroundColor: { default: 'transparent', ':hover': 'rgba(255,255,255,0.18)' },
    cursor: 'pointer',
  },
  label: { minWidth: 150, textAlign: 'center', whiteSpace: 'nowrap' },
});

function Switcher({ current }: { current: Key }) {
  const name = VARIANTS.find((each) => each.key === current)!.name;

  return (
    <div {...stylex.props(styles.bar)}>
      <button
        type="button"
        aria-label="Previous variant"
        {...stylex.props(styles.arrow)}
        onClick={() => choose(step(current, -1))}
      >
        <ChevronLeft size={16} />
      </button>
      <span {...stylex.props(styles.label)}>
        {current === 'now' ? 'Current' : `${current} · ${name}`}
      </span>
      <button
        type="button"
        aria-label="Next variant"
        {...stylex.props(styles.arrow)}
        onClick={() => choose(step(current, 1))}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

/** Wraps the real Changes view; in dev it can swap it for a variant. */
export function ChangesPrototypeHost({
  showing,
  children,
}: {
  showing: boolean;
  children: ReactNode;
}) {
  const current = useSyncExternalStore(subscribe, readKey);

  useEffect(() => {
    if (!showing) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"], select')) return;
      if (event.key === 'ArrowLeft') choose(step(readKey(), -1));
      if (event.key === 'ArrowRight') choose(step(readKey(), 1));
    };
    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [showing]);

  if (!import.meta.env.DEV) return <>{children}</>;

  return (
    <>
      {current === 'now' && children}
      {current === 'A' && <Ledger />}
      {current === 'B' && <Review />}
      {current === 'C' && <CommitFirst />}
      {showing && <Switcher current={current} />}
    </>
  );
}
