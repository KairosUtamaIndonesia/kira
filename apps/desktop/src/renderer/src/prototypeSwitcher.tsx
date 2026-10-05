/**
 * PROTOTYPE — the floating bar that flips between variants of a page. Wipe me with them.
 *
 * Development builds only: a prototype merged by mistake must not put this bar in front of
 * anyone. ← and → cycle the variants, except while a field has focus.
 */
import * as stylex from '@stylexjs/stylex';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect } from 'react';

export interface PrototypeVariant {
  key: string;
  name: string;
}

interface Props {
  variants: PrototypeVariant[];
  current: string;
  onChange: (key: string) => void;
  /** A second, smaller set of choices beside the variants (which data the page is drawn with). */
  options?: {
    label: string;
    choices: PrototypeVariant[];
    current: string;
    onChange: (key: string) => void;
  };
}

function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.matches('input, textarea, select') || target.isContentEditable)
  );
}

export function PrototypeSwitcher({ variants, current, onChange, options }: Props) {
  const index = Math.max(
    0,
    variants.findIndex((each) => each.key === current),
  );
  const named = variants[index];
  const step = (by: number): void =>
    onChange(variants[(index + by + variants.length) % variants.length]!.key);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'ArrowRight') step(1);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!import.meta.env.DEV) return null;

  return (
    <div role="toolbar" aria-label="Prototype variants" {...stylex.props(ui.bar)}>
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => step(-1)}
        {...stylex.props(ui.arrow)}
      >
        <ChevronLeft size={16} />
      </button>
      <span {...stylex.props(ui.label)} aria-live="polite">
        <strong>{named?.key}</strong> {named?.name}
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => step(1)}
        {...stylex.props(ui.arrow)}
      >
        <ChevronRight size={16} />
      </button>
      {options && (
        <fieldset aria-label={options.label} {...stylex.props(ui.group)}>
          {options.choices.map((choice) => (
            <button
              key={choice.key}
              type="button"
              aria-pressed={choice.key === options.current}
              onClick={() => options.onChange(choice.key)}
              {...stylex.props(ui.choice, choice.key === options.current && ui.choiceOn)}
            >
              {choice.name}
            </button>
          ))}
        </fieldset>
      )}
    </div>
  );
}

const ui = stylex.create({
  bar: {
    position: 'fixed',
    insetBlockEnd: 16,
    insetInlineStart: '50%',
    transform: 'translateX(-50%)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: 4,
    borderRadius: 999,
    backgroundColor: '#111',
    color: '#fff',
    boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
    fontSize: 13,
    fontFamily: 'system-ui, sans-serif',
  },
  arrow: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    padding: 0,
    border: 0,
    borderRadius: 999,
    background: { default: 'transparent', ':hover': 'rgba(255,255,255,0.16)' },
    color: 'inherit',
    cursor: 'pointer',
  },
  label: { minWidth: 150, textAlign: 'center', whiteSpace: 'nowrap' },
  group: {
    display: 'flex',
    margin: 0,
    minWidth: 0,
    borderBlockWidth: 0,
    borderInlineEndWidth: 0,
    paddingBlock: 0,
    paddingInlineEnd: 0,
    gap: 2,
    marginInlineStart: 4,
    paddingInlineStart: 8,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: 'rgba(255,255,255,0.24)',
  },
  choice: {
    height: 28,
    paddingInline: 10,
    border: 0,
    borderRadius: 999,
    background: { default: 'transparent', ':hover': 'rgba(255,255,255,0.16)' },
    color: 'rgba(255,255,255,0.72)',
    font: 'inherit',
    cursor: 'pointer',
  },
  choiceOn: { backgroundColor: '#fff', color: '#111' },
});
