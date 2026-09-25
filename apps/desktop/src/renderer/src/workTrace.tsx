import { ChatToolCalls, type ChatToolCallItem } from '@astryxdesign/core/Chat';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { useCollapsible } from '@astryxdesign/core/Collapsible';
import { Icon } from '@astryxdesign/core/Icon';
import { Markdown } from '@astryxdesign/core/Markdown';
import { Text } from '@astryxdesign/core/Text';
import {
  borderVars,
  colorVars,
  durationVars,
  easeVars,
  focusVars,
  spacingVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import { useId, type ReactNode } from 'react';
import * as stylex from '@stylexjs/stylex';
import type { ChatPart, ToolImage, ToolRun } from '../../preload/bridge';

/** Visual language for one compact, card-free execution trace. */
const styles = stylex.create({
  root: { maxWidth: '100%' },
  trigger: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1'],
    width: 'fit-content',
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    cursor: 'pointer',
    textAlign: 'start',
    ':focus-visible': {
      outlineWidth: focusVars['--focus-outline-width'],
      outlineStyle: focusVars['--focus-outline-style'],
      outlineColor: focusVars['--focus-outline-color'],
      outlineOffset: focusVars['--focus-outline-offset'],
    },
  },
  chevron: {
    transitionProperty: 'transform',
    transitionDuration: durationVars['--duration-fast'],
    transitionTimingFunction: easeVars['--ease-standard'],
  },
  chevronOpen: { transform: 'rotate(90deg)' },
  content: {
    marginInlineStart: spacingVars['--spacing-1'],
    marginBlockStart: spacingVars['--spacing-2'],
    paddingInlineStart: spacingVars['--spacing-3'],
    borderInlineStartWidth: borderVars['--border-width'],
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: colorVars['--color-border'],
  },
  reasoning: {
    // Markdown reads Astryx's primary-text variable for bold and other inline
    // elements. Scope it to the secondary token rather than fighting children.
    '--color-text-primary': colorVars['--color-text-secondary'],
  },
  tools: { marginBlockStart: spacingVars['--spacing-1'] },
  detail: {
    // ChatToolCalls indents results beneath the tool name. The trace's rail
    // already establishes that hierarchy, so cancel the component's offset.
    marginInlineStart: `calc(-1 * (16px + ${spacingVars['--spacing-1-5']}))`,
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    paddingBlock: spacingVars['--spacing-1'],
  },
  result: { color: colorVars['--color-text-secondary'] },
  image: {
    display: 'block',
    maxWidth: '100%',
    maxHeight: 320,
    objectFit: 'contain',
  },
});

/**
 * One step of Kira's work: what Kira thought, and what Kira ran because of it,
 * behind a single "Worked for" row.
 *
 * Open by default only while a tool in it is still running — a step read after
 * the fact is history, and stays out of the way of the answer that follows it;
 * a step read as it happens is the answer, for now, and stays in view.
 */
export function Work({
  part,
  isWorking = false,
}: {
  part: Extract<ChatPart, { type: 'work' }>;
  isWorking?: boolean;
}) {
  const running = isWorking || part.calls.some((call) => call.status === 'running');
  const label = running
    ? 'Working…'
    : part.calls.length > 0
      ? `Worked for ${spent(part.durationMs ?? 0)}`
      : 'Thought for a moment';

  return (
    <div {...stylex.props(styles.root)}>
      <TraceDisclosure label={label} defaultIsOpen={running}>
        {part.reasoning !== null && (
          // Read as markdown, because that is what Kira thinks in: Kira's summaries
          // arrive bold and Kira's reasoning runs in lists, and the punctuation is
          // structure rather than something Kira typed at us.
          <div {...stylex.props(styles.reasoning)}>
            <Markdown>{part.reasoning}</Markdown>
          </div>
        )}
        {part.calls.length > 0 && (
          // Expanded, because a transcript is read rather than interrogated: the
          // work is the shape of the turn, and a group that starts closed hides
          // what Kira did to get here.
          <ChatToolCalls xstyle={styles.tools} calls={part.calls.map(toolCall)} defaultIsExpanded />
        )}
      </TraceDisclosure>
    </div>
  );
}

/** An Astryx disclosure state machine with the compact trace presentation. */
function TraceDisclosure({
  label,
  defaultIsOpen,
  children,
}: {
  label: string;
  defaultIsOpen: boolean;
  children: ReactNode;
}) {
  const { isOpen, toggle } = useCollapsible({ isCollapsible: { defaultIsOpen } });
  const contentId = useId();

  return (
    <>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={toggle}
        {...stylex.props(styles.trigger)}
      >
        <Icon
          icon="chevronRight"
          size="sm"
          color="secondary"
          xstyle={[styles.chevron, isOpen && styles.chevronOpen]}
        />
        <Text type="supporting" weight="medium" color="secondary">
          {label}
        </Text>
      </button>
      {isOpen && (
        <div {...stylex.props(styles.content)} id={contentId}>
          {children}
        </div>
      )}
    </>
  );
}

/**
 * One tool run as Astryx draws it.
 *
 * The label on the row is a glance, not a read — see {@link shorten}. When it
 * hides something (the raw target had a newline flattened, or ran past the
 * limit), the row becomes clickable and the full text opens beneath it as a
 * code block, so nothing pi did is actually out of reach.
 */
function toolCall(call: ToolRun): ChatToolCallItem {
  const target = call.target === null ? undefined : shorten(call.target);
  const detail: ReactNode[] = [];

  // The row shows a long command cut short, so the whole of it belongs here.
  if (call.target !== null && call.target !== target) {
    detail.push(fullTarget(call.name, call.target));
  }

  // And what came back: the output it returned, or the change it made.
  if (call.output !== null) {
    detail.push(cameBack(call.output));
  }
  for (const [index, image] of (call.images ?? []).entries()) {
    detail.push(imageResult(image, index));
  }

  return {
    name: call.name,
    status: call.status,
    target,
    duration: call.durationMs === null ? undefined : spent(call.durationMs),
    additions: call.additions ?? undefined,
    deletions: call.deletions ?? undefined,
    resultDetail:
      detail.length === 0 ? undefined : <div {...stylex.props(styles.detail)}>{detail}</div>,
  };
}

/**
 * A target as a label, not a script.
 *
 * pi names `bash`'s target with its whole command, which can be a pipeline of
 * several statements; Astryx draws it on one line, so anything past a glance
 * is cut short. The row still says which command ran — the full text is one
 * click away, in {@link fullTarget}.
 */
function shorten(target: string): string {
  const flat = target.replace(/\s+/g, ' ').trim();
  const limit = 64;
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** The whole target, shown inline with the trace rather than as a second card. */
function fullTarget(name: string, target: string) {
  return (
    <CodeBlock
      key="target"
      code={target}
      language={name === 'bash' ? 'bash' : 'plaintext'}
      size="sm"
      width="100%"
      hasLanguageLabel={false}
      xstyle={styles.result}
    />
  );
}

/**
 * What a tool came back with, in the same trace it belongs to.
 *
 * No language is named, because the tool is the one that decides what this is —
 * a command's output, a file's contents, a failure's message, or the lines an
 * edit changed — and calling it any single one of those would be wrong more
 * often than right.
 */
function cameBack(output: string) {
  return (
    <CodeBlock
      key="output"
      code={output}
      language="plaintext"
      size="sm"
      width="100%"
      hasLanguageLabel={false}
      xstyle={styles.result}
    />
  );
}

/** Draw an image result as an image rather than exposing its base64 payload. */
function imageResult(image: ToolImage, index: number) {
  return (
    <img
      key={`image-${index}`}
      src={`data:${image.mimeType};base64,${image.data}`}
      alt="Tool result"
      {...stylex.props(styles.image)}
    />
  );
}

/**
 * How long a tool took, as it reads beside the call: milliseconds while that is
 * still the useful unit, then seconds, and minutes once there are enough of them.
 */
function spent(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = ms / 1000;

  if (seconds < 60) {
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);

  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}
