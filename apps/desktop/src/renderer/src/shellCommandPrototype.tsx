/**
 * PROTOTYPE — three ways to compose and read local `!` commands on the chat route.
 * Switch with `?variant=terminal|workspace|inline`; buttons only show a local preview.
 */
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import {
  borderVars,
  colorVars,
  radiusVars,
  shadowVars,
  spacingVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronLeft, ChevronRight, Terminal } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import type { ShellCommandRun } from '../../preload/bridge';

export const shellPrototypeVariants = [
  { key: 'terminal', name: 'Terminal card' },
  { key: 'workspace', name: 'Workspace stage' },
  { key: 'inline', name: 'Inline history' },
] as const;

export type ShellPrototypeVariant = (typeof shellPrototypeVariants)[number]['key'];

type ComposerProps = {
  draft: string;
  onDraftChange: (draft: string) => void;
  preview: string | null;
  onPreview: () => void;
};

export function initialShellPrototypeVariant(): ShellPrototypeVariant {
  const requested = new URLSearchParams(window.location.search).get('variant');
  return shellPrototypeVariants.some((variant) => variant.key === requested)
    ? (requested as ShellPrototypeVariant)
    : 'terminal';
}

export function writeShellPrototypeVariant(variant: ShellPrototypeVariant): void {
  const url = new URL(window.location.href);
  url.searchParams.set('variant', variant);
  window.history.replaceState(null, '', url);
}

export function ShellPrototypeBar({
  variant,
  onChange,
}: {
  variant: ShellPrototypeVariant;
  onChange: (variant: ShellPrototypeVariant) => void;
}): ReactNode {
  const currentIndex = shellPrototypeVariants.findIndex((each) => each.key === variant);
  const selectRelative = (step: number): void => {
    const currentKey = new URLSearchParams(window.location.search).get('variant');
    const liveIndex = shellPrototypeVariants.findIndex((each) => each.key === currentKey);
    const baseIndex = liveIndex < 0 ? currentIndex : liveIndex;
    const nextIndex = (baseIndex + step + shellPrototypeVariants.length) % shellPrototypeVariants.length;
    onChange(shellPrototypeVariants[nextIndex]!.key);
  };

  useMountEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) return;
      event.preventDefault();
      selectRelative(event.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const current = shellPrototypeVariants[currentIndex] ?? shellPrototypeVariants[0];
  return (
    <nav {...stylex.props(styles.switcher)} aria-label="Shell command prototype variants">
      <Button
        label="Previous variant"
        size="sm"
        variant="ghost"
        icon={<Icon icon={ChevronLeft} size="sm" />}
        isIconOnly
        onClick={() => selectRelative(-1)}
      />
      <Text size="sm" weight="medium" aria-live="polite">
        {current.key} · {current.name}
      </Text>
      <Button
        label="Next variant"
        size="sm"
        variant="ghost"
        icon={<Icon icon={ChevronRight} size="sm" />}
        isIconOnly
        onClick={() => selectRelative(1)}
      />
    </nav>
  );
}

export function ShellCommandPrototypeComposer({
  variant,
  draft,
  onDraftChange,
  preview,
  onPreview,
}: ComposerProps & { variant: ShellPrototypeVariant }): ReactNode {
  const commandInput = (
    <textarea
      aria-label="Local command draft"
      rows={1}
      spellCheck={false}
      value={draft}
      onChange={(event) => onDraftChange(event.currentTarget.value)}
      {...stylex.props(styles.commandInput)}
    />
  );

  if (variant === 'workspace') {
    return (
      <section {...stylex.props(styles.workspaceComposer)} aria-label="Local command composer">
        <div {...stylex.props(styles.workspaceHeading)}>
          <Icon icon={Terminal} size="sm" color="secondary" />
          <div {...stylex.props(styles.workspaceHeadingText)}>
            <Text weight="medium">Run in this chat’s workspace</Text>
            <Text color="secondary" size="sm">Local shell · preview only</Text>
          </div>
        </div>
        <div {...stylex.props(styles.workspaceInput)}>
          <span aria-hidden="true">!</span>{commandInput}
        </div>
        <Button label="Preview run" icon={<Icon icon={Terminal} size="sm" />} onClick={onPreview} />
        <div {...stylex.props(styles.workspaceFoot)}>
          <Text color="secondary" size="sm">Preview only · command stays attached to this chat.</Text>
        </div>
        {preview ? <Text color="secondary" size="sm" aria-live="polite">{preview}</Text> : null}
      </section>
    );
  }

  if (variant === 'inline') {
    return (
      <section {...stylex.props(styles.inlineComposer)} aria-label="Local command composer">
        <span {...stylex.props(styles.inlinePrompt)} aria-hidden="true">!</span>
        {commandInput}
        <Button label="Preview" size="sm" variant="secondary" onClick={onPreview} />
        {preview ? <Text color="secondary" size="sm" aria-live="polite">{preview}</Text> : null}
      </section>
    );
  }

  return (
    <section {...stylex.props(styles.terminalComposer)} aria-label="Local command composer">
      <div {...stylex.props(styles.terminalComposerHead)}>
        <span {...stylex.props(styles.terminalLabel)}>
          <Icon icon={Terminal} size="sm" color="secondary" />
          <Text weight="medium" size="sm">Local command</Text>
        </span>
        <Text color="secondary" size="sm">Preview only</Text>
      </div>
      <div {...stylex.props(styles.terminalInput)}>
        <span aria-hidden="true">!</span>{commandInput}
      </div>
      <div {...stylex.props(styles.terminalComposerFoot)}>
        {preview ? <Text color="secondary" size="sm" aria-live="polite">{preview}</Text> : <span />}
        <Button label="Preview run" icon={<Icon icon={Terminal} size="sm" />} onClick={onPreview} />
      </div>
    </section>
  );
}

export function ShellCommandPrototypeTranscript({
  run,
  variant,
}: {
  run: ShellCommandRun;
  variant: ShellPrototypeVariant;
}): ReactNode {
  const status = run.status === 'running'
    ? 'Running'
    : run.status === 'cancelled'
      ? 'Cancelled'
      : run.status === 'error'
        ? `Failed · exit ${run.exitCode ?? 'unknown'}`
        : `Finished · exit ${run.exitCode ?? 'unknown'}`;
  const output = run.output || 'No output';

  if (variant === 'workspace') {
    return (
      <section {...stylex.props(styles.workspaceResult)} aria-label="Local command result">
        <div {...stylex.props(styles.resultRail)}>
          <Text size="sm" weight="medium">LOCAL</Text>
          <Text color="secondary" size="sm">{status}</Text>
        </div>
        <div {...stylex.props(styles.workspaceResultMain)}>
          <code {...stylex.props(styles.workspaceCommand)}>! {run.command}</code>
          <pre {...stylex.props(styles.resultOutput)}>{output}</pre>
          {run.truncated ? <Text color="secondary" size="sm">Output truncated</Text> : null}
          {run.fullOutputPath === null ? null : (
            <Text color="secondary" size="sm">Full output: {run.fullOutputPath}</Text>
          )}
        </div>
      </section>
    );
  }

  if (variant === 'inline') {
    return (
      <details {...stylex.props(styles.inlineResult)}>
        <summary {...stylex.props(styles.inlineSummary)}>
          <code>! {run.command}</code>
          <Text color="secondary" size="sm">
            {status}{run.truncated ? ' · output truncated' : ''}
          </Text>
        </summary>
        <pre {...stylex.props(styles.inlineOutput)}>{output}</pre>
        {run.fullOutputPath === null ? null : (
          <Text color="secondary" size="sm">Full output: {run.fullOutputPath}</Text>
        )}
      </details>
    );
  }

  return (
    <section {...stylex.props(styles.terminalResult)} aria-label="Local command result">
      <header {...stylex.props(styles.terminalResultHead)}>
        <span {...stylex.props(styles.terminalLabel)}>
          <Icon icon={Terminal} size="sm" />
          <Text weight="medium" size="sm">Local command</Text>
        </span>
        <Text color="secondary" size="sm">{status}{run.truncated ? ' · output truncated' : ''}</Text>
      </header>
      <code {...stylex.props(styles.terminalCommand)}>! {run.command}</code>
      {run.output ? <pre {...stylex.props(styles.resultOutput)}>{run.output}</pre> : null}
      {run.fullOutputPath === null ? null : (
        <Text color="secondary" size="sm">Full output: {run.fullOutputPath}</Text>
      )}
    </section>
  );
}

function useMountEffect(effect: () => void | (() => void)): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

const styles = stylex.create({
  switcher: {
    position: 'fixed',
    zIndex: 1000,
    insetInlineStart: '50%',
    insetBlockEnd: spacingVars['--spacing-6'],
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    padding: spacingVars['--spacing-1'],
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border-emphasized'],
    borderRadius: radiusVars['--radius-full'],
    backgroundColor: colorVars['--color-background-surface'],
    boxShadow: shadowVars['--shadow-med'],
    whiteSpace: 'nowrap',
  },
  terminalComposer: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    width: 'min(100%, 46rem)',
    marginInline: 'auto',
    padding: spacingVars['--spacing-3'],
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-page'],
    backgroundColor: colorVars['--color-background-surface'],
  },
  terminalComposerHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
  },
  terminalLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
  },
  terminalInput: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    paddingInline: spacingVars['--spacing-2'],
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: colorVars['--color-background-muted'],
    fontFamily: 'var(--font-family-code)',
  },
  commandInput: {
    flex: 1,
    minWidth: '8rem',
    resize: 'vertical',
    paddingBlock: spacingVars['--spacing-2'],
    border: 0,
    outline: 'none',
    backgroundColor: 'transparent',
    color: colorVars['--color-text-primary'],
    font: 'inherit',
    lineHeight: 1.5,
  },
  terminalComposerFoot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
  },
  workspaceComposer: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: spacingVars['--spacing-2'],
    width: 'min(100%, 54rem)',
    marginInline: 'auto',
    padding: spacingVars['--spacing-3'],
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: colorVars['--color-background-muted'],
  },
  workspaceHeading: {
    gridColumn: '1 / -1',
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
  },
  workspaceHeadingText: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-0-5'],
  },
  workspaceInput: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    minWidth: 0,
    paddingInline: spacingVars['--spacing-2'],
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border-emphasized'],
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: colorVars['--color-background-surface'],
    color: colorVars['--color-text-primary'],
    fontFamily: 'var(--font-family-code)',
  },
  workspaceFoot: {
    gridColumn: '1 / -1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
    flexWrap: 'wrap',
  },
  inlineComposer: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacingVars['--spacing-2'],
    width: 'min(100%, 46rem)',
    marginInline: 'auto',
    padding: spacingVars['--spacing-2'],
    borderBlockWidth: borderVars['--border-width'],
    borderBlockStyle: 'solid',
    borderBlockColor: colorVars['--color-border'],
    backgroundColor: colorVars['--color-background-surface'],
  },
  inlinePrompt: {
    color: colorVars['--color-accent'],
    fontFamily: 'var(--font-family-code)',
  },
  terminalResult: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    width: '100%',
    minWidth: 0,
    padding: spacingVars['--spacing-3'],
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: colorVars['--color-background-surface'],
  },
  terminalResultHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
  },
  terminalCommand: {
    display: 'block',
    padding: spacingVars['--spacing-2'],
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: colorVars['--color-background-muted'],
    color: colorVars['--color-text-primary'],
    fontFamily: 'var(--font-family-code)',
    overflowWrap: 'anywhere',
  },
  workspaceResult: {
    display: 'grid',
    gridTemplateColumns: '6rem minmax(0, 1fr)',
    gap: spacingVars['--spacing-3'],
    width: '100%',
    paddingBlock: spacingVars['--spacing-3'],
    borderBlockWidth: borderVars['--border-width'],
    borderBlockStyle: 'solid',
    borderBlockColor: colorVars['--color-border'],
  },
  resultRail: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
  },
  workspaceResultMain: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    minWidth: 0,
  },
  workspaceCommand: {
    fontFamily: 'var(--font-family-code)',
    color: colorVars['--color-text-primary'],
    overflowWrap: 'anywhere',
  },
  resultOutput: {
    maxHeight: '16rem',
    overflow: 'auto',
    margin: 0,
    padding: spacingVars['--spacing-2'],
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: colorVars['--color-background-muted'],
    color: colorVars['--color-text-primary'],
    fontFamily: 'var(--font-family-code)',
    fontSize: '0.75rem',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  inlineResult: {
    width: '100%',
    borderBlockWidth: borderVars['--border-width'],
    borderBlockStyle: 'solid',
    borderBlockColor: colorVars['--color-border'],
    color: colorVars['--color-text-primary'],
    fontFamily: 'var(--font-family-code)',
    fontSize: '0.875rem',
  },
  inlineSummary: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
    paddingBlock: spacingVars['--spacing-2'],
    cursor: 'pointer',
    listStyle: 'none',
  },
  inlineOutput: {
    maxHeight: '10rem',
    overflow: 'auto',
    margin: 0,
    padding: spacingVars['--spacing-2'],
    backgroundColor: colorVars['--color-background-muted'],
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
});
