import { Button } from '@astryxdesign/core/Button';
import {
  ChatComposer,
  ChatComposerInput,
  ChatSendButton,
  type ChatComposerProps,
} from '@astryxdesign/core/Chat';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { Popover } from '@astryxdesign/core/Popover';
import { VStack } from '@astryxdesign/core/VStack';
import { borderVars, colorVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import { useAui, useAuiState } from '@assistant-ui/react';
import { ChevronDown, Gauge, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import * as stylex from '@stylexjs/stylex';
import type { ChatMode, ChatUsage, ModelOption, QueuedLine, Usage } from '../../preload/bridge';
import { chatLines, formatTokens, warningFor } from './allowanceText';
import {
  browserElementsInMessage,
  describeBrowserElement,
  formatBrowserElementDraft,
  type BrowserElementSelection,
} from './browser/elementSelection';

/**
 * The composer, said in Astryx's words.
 *
 * Astryx's ChatComposer holds a draft and offers to send it; the runtime holds
 * the draft too — each chat's runtime keeps its own, and switching chats is what
 * discards one — and it is the one that knows when sending is allowed. This is
 * the only place the runtime's answer is said in Astryx's words, so nothing else
 * has to know which prop carries which fact.
 *
 * One of the shell's own readings is not the runtime's, and is answered here
 * rather than left to it: `isDisabled` is never set, because to the shell it
 * means nothing can be typed here, which is not what a turn in flight means.
 *
 * Sending mid-turn is the runtime's own rule too — there is nothing to gate,
 * because a chat that is already answering holds the words instead of refusing
 * them — but which turn they wait for is the sender's, so Enter and Alt+Enter
 * are two different promises. `queued` is what the words are doing meanwhile,
 * and stopping hands them back into this box, so the box is where they return.
 */
export function Composer({
  placeholder,
  error,
  usage = null,
  chatUsage = null,
  models = [],
  modelId = null,
  onChoose,
  mode = 'build',
  onChooseMode,
  queued = [],
  restored = null,
  onTakeBack,
  onRestored,
  isEditing = false,
  browserElements = [],
  onBrowserElementsChange,
}: {
  placeholder: string;
  error?: string | null;
  /** What this person has used of their allowance this month, or no reading. */
  usage?: Usage | null;
  /** What this chat itself has used, or null when there is no session to have used it. */
  chatUsage?: ChatUsage | null;
  /** The models Kira offers, in the pool's own order. */
  models?: ModelOption[];
  /** The model this chat runs on, or null when it has chosen none. */
  modelId?: string | null;
  /** Run this chat on the model named. */
  onChoose?: (modelId: string) => void;
  /** Run the next turn in build or spec mode. */
  mode?: ChatMode;
  onChooseMode?: (mode: ChatMode) => void;
  queued?: QueuedLine[];
  restored?: string | null;
  onTakeBack?: () => Promise<void>;
  onRestored?: () => void;
  isEditing?: boolean;
  browserElements?: BrowserElementSelection[];
  onBrowserElementsChange?: (browserElements: BrowserElementSelection[]) => void;
}): ReactNode {
  const aui = useAui();
  const text = useAuiState((state) => state.composer.text);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  // True only while a turn is running in this chat, because the runtime is the
  // one that knows both halves: whether stopping is possible at all — we said so
  // by handing the adapter a cancel — and whether anything is being written.
  const canCancel = useAuiState((state) => state.composer.canCancel);

  // The runtime calls words sendable when there are words and nothing is already
  // on its way out. An edit is the exception: it replaces a message *and* sends
  // the replacement, so it still waits for a turn that is running to finish.
  const canSend = useAuiState((state) => state.composer.canSend) && !(isEditing && isRunning);
  const sendDraft = (steer: boolean = true): void => {
    if (isEditing || browserElements.length === 0) {
      if (steer) aui.composer.send();
      else aui.composer.send({ steer: false });
      return;
    }
    aui.composer.setText(browserElementsInMessage(aui.composer.getState().text, browserElements));
    onBrowserElementsChange?.([]);
    if (steer) aui.composer.send();
    else aui.composer.send({ steer: false });
  };

  useEffect(() => {
    if (restored === null) {
      return;
    }

    // Words that came back were written before whatever is in the box now, so
    // they go first and the draft is kept after them: taking back what you said
    // must not eat what you were saying. A blank line between them, because they
    // were separate things to say.
    const draft = aui.composer.getState().text;
    aui.composer.setText([restored, draft].filter((each) => each.trim()).join('\n\n'));
    onRestored?.();
  }, [restored, aui, onRestored]);

  const composer: ChatComposerProps = {
    value: text,
    onChange: (next) => aui.composer.setText(next),
    onSubmit: () => sendDraft(),
    placeholder,
    // The refusal owns the status line, because it is what the reader has to act
    // on; the warning has it only when nothing else does. Astryx's own slot under
    // the box either way.
    status: error
      ? { type: 'error', message: error }
      : usage?.warned
        ? { type: 'warning', message: warningFor(usage) }
        : undefined,
    // The gauge, mode, and model choices all belong beside the send button: they
    // describe what the next turn will use, rather than the draft itself.
    sendActions: isEditing ? (
      usage === null && chatUsage === null ? undefined : (
        <ContextGauge usage={usage} chatUsage={chatUsage} />
      )
    ) : (
      <div className="composer-send-actions">
        {usage === null && chatUsage === null ? null : (
          <ContextGauge usage={usage} chatUsage={chatUsage} />
        )}
        <fieldset className="chat-mode-switcher" aria-label="Chat mode">
          <Button
            label="Build"
            size="sm"
            variant={mode === 'build' ? 'primary' : 'ghost'}
            aria-pressed={mode === 'build'}
            isDisabled={isRunning || onChooseMode === undefined}
            onClick={() => onChooseMode?.('build')}
          />
          <Button
            label="Spec"
            size="sm"
            variant={mode === 'spec' ? 'primary' : 'ghost'}
            aria-pressed={mode === 'spec'}
            isDisabled={isRunning || onChooseMode === undefined}
            onClick={() => onChooseMode?.('spec')}
          />
        </fieldset>
        {pickerFor(models, modelId, onChoose, isRunning)}
      </div>
    ),
    // The same button, in its other state: while Kira is writing there is
    // something to stop, and stopping is what it does instead of sending.
    isStopShown: canCancel && !isEditing,
    onStop: () => aui.composer.cancel(),
    input: (
      <ChatComposerInput
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) {
            return;
          }

          // Alt+Enter says the same words, but holds them to the end of this
          // turn instead of handing them over at Kira's next step.
          if (event.altKey && canSend) {
            event.preventDefault();
            sendDraft(false);
            return;
          }

          if (!canSend) {
            event.preventDefault();
          }
        }}
      />
    ),
    sendButton: isEditing ? (
      <Button label="Save" isDisabled={!canSend} onClick={() => sendDraft()} />
    ) : (
      <ChatSendButton isDisabled={!canSend} />
    ),
  };

  // Inside a message this is that message's own composer: the box starts with
  // the words it is replacing, saving says them again, and Cancel leaves them as
  // they were. Only the one in the footer has a queue behind it.
  return isEditing ? (
    <ChatComposer
      {...composer}
      footerActions={
        <Button label="Cancel" size="sm" variant="ghost" onClick={() => aui.composer.cancel()} />
      }
    />
  ) : (
    <div className="composer-stack">
      {browserElements.length > 0 && (
        <BrowserElementAttachments
          selections={browserElements}
          onRemove={(index) =>
            onBrowserElementsChange?.(browserElements.filter((_, each) => each !== index))
          }
        />
      )}
      {queued.length > 0 && (
        <div className="waiting" aria-label="Waiting to be read">
          {queued.map((line, index) => (
            // pi's queue is words, not messages: one line has no id of its own, and
            // taking one back means taking all of them, so the place it sits is
            // what names it.
            <div className="waiting-line" key={`${line.lane}-${index}`}>
              <Text color="secondary" size="sm">
                {/* When Kira will read it — the only thing that differs. */}
                {line.lane === 'next' ? 'next' : 'later'}
              </Text>
              <Text>{line.text}</Text>
            </div>
          ))}
          <Button
            label="Take them back"
            size="sm"
            variant="ghost"
            onClick={() => void onTakeBack?.()}
          />
        </div>
      )}
      <ChatComposer {...composer} />
      {isRunning && (
        <Text color="secondary" size="sm">
          {queued.length > 0
            ? 'Enter steers Kira’s next step · Alt+Enter waits until Kira is done'
            : 'Kira is writing. Enter steers Kira’s next step · Alt+Enter waits until Kira is done.'}
        </Text>
      )}
    </div>
  );
}

/**
 * What this person has used of their allowance, behind an icon.
 *
 * The month is context rather than a task: it is read when somebody wonders how
 * close they are and ignored the rest of the time, so it sits behind a gauge beside
 * the send button — the slot Astryx keeps for actions to the left of it — and
 * opening the gauge is what shows the month. A bar rather than a number, because the
 * question it answers is "how close am I" — and a number beside it anyway, because
 * "17.2M of 20.0M" is what "how close" means when you want to know. The window
 * draws what the server said and works nothing out: `warned` is the server's
 * reading of its own threshold, so it is what colours the bar
 * (docs/adr/0005-allowances.md).
 *
 * Nothing is drawn when there is no reading — signed out, or a server that could not
 * be asked — because a bar has to mean something, and a full one would say this
 * person had spent nothing. The gauge itself is drawn whenever there is something
 * behind it, which is either reading: a month's spend, or a chat that can say what
 * it has used.
 */
/** The meter fills its tooltip, not the composer around it. */
const styles = stylex.create({
  allowance: { width: '100%' },
  // The month's number belongs on the card's right edge, matching the context
  // figure below it rather than merely following its label.
  monthValue: { display: 'block', textAlign: 'end' },
  // The chat's own numbers are a separate reading from the bar above them, so they
  // are set apart from it rather than running on from it.
  chatUsage: { marginBlockStart: 8 },
  browserElements: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacingVars['--spacing-2'],
    paddingInline: spacingVars['--spacing-3'],
    border: 0,
    margin: 0,
    minWidth: 0,
  },
  browserElement: {
    minWidth: 0,
    maxWidth: '100%',
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: '0.5rem',
    backgroundColor: colorVars['--color-background-surface'],
  },
  browserElementHead: {
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
  },
  browserElementToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    minWidth: 0,
    paddingBlock: spacingVars['--spacing-1-5'],
    paddingInline: spacingVars['--spacing-2'],
    border: 0,
    backgroundColor: 'transparent',
    color: colorVars['--color-text-primary'],
    font: 'inherit',
    cursor: 'pointer',
    textAlign: 'start',
  },
  browserElementLabel: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  browserElementChevron: {
    flexShrink: 0,
    color: colorVars['--color-text-secondary'],
    transform: 'rotate(0deg)',
    transition: 'transform 150ms ease-out',
  },
  browserElementExpanded: { transform: 'rotate(180deg)' },
  browserElementPreview: {
    maxWidth: 'min(40rem, 80vw)',
    maxHeight: '14rem',
    overflow: 'auto',
    margin: 0,
    paddingBlock: spacingVars['--spacing-2'],
    paddingInline: spacingVars['--spacing-3'],
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
    color: colorVars['--color-text-secondary'],
    fontSize: '0.75rem',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
});

function BrowserElementAttachments({
  selections,
  onRemove,
}: {
  selections: BrowserElementSelection[];
  onRemove: (index: number) => void;
}): ReactNode {
  return (
    <fieldset {...stylex.props(styles.browserElements)} aria-label="Browser elements in this draft">
      {selections.map((selection, index) => (
        <BrowserElementAttachment
          key={`${selection.url}:${selection.selector}:${index}`}
          selection={selection}
          onRemove={() => onRemove(index)}
        />
      ))}
    </fieldset>
  );
}

function BrowserElementAttachment({
  selection,
  onRemove,
}: {
  selection: BrowserElementSelection;
  onRemove: () => void;
}): ReactNode {
  const [isExpanded, setIsExpanded] = useState(false);
  const label = describeBrowserElement(selection);
  return (
    <div {...stylex.props(styles.browserElement)}>
      <div {...stylex.props(styles.browserElementHead)}>
        <button
          {...stylex.props(styles.browserElementToggle)}
          type="button"
          aria-label={`${isExpanded ? 'Hide' : 'Show'} preview for ${label}`}
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((expanded) => !expanded)}
        >
          <span {...stylex.props(styles.browserElementLabel)}>{label}</span>
          <span
            {...stylex.props(
              styles.browserElementChevron,
              isExpanded && styles.browserElementExpanded,
            )}
            aria-hidden="true"
          >
            <Icon icon={ChevronDown} size="sm" />
          </span>
        </button>
        <IconButton
          label={`Remove ${label}`}
          icon={<Icon icon={X} size="sm" />}
          variant="ghost"
          size="sm"
          onClick={onRemove}
        />
      </div>
      {isExpanded && (
        <pre {...stylex.props(styles.browserElementPreview)}>
          {formatBrowserElementDraft(selection)}
        </pre>
      )}
    </div>
  );
}

/**
 * Which model this chat runs on, as a picker in the composer's footer.
 *
 * Astryx keeps that slot for exactly this — "left-aligned footer actions (model
 * selector, etc)" — because the choice is about the next thing said rather than
 * about the app. What it offers is what Kira offers, in the pool's own order,
 * so a model that cannot answer is not on the list to be picked.
 *
 * A chat that has chosen nothing shows the first of them rather than nothing at
 * all, because that is what it will run on: an empty picker would be asking a
 * question the pool has already answered.
 *
 * While Kira is writing it is disabled rather than hidden — the model in use is
 * still worth reading — and the reason is handed to Astryx's own
 * `disabledMessage`, which is what a disabled control needs instead of a tooltip
 * around it (the control swallows the hover an outer tooltip listens for).
 */
function pickerFor(
  models: ModelOption[],
  modelId: string | null,
  onChoose: ((modelId: string) => void) | undefined,
  isRunning: boolean,
): ReactNode {
  if (models.length === 0 || onChoose === undefined) {
    return undefined;
  }

  return (
    <Selector
      label="Model"
      isLabelHidden
      size="sm"
      variant="ghost"
      options={models.map((model) => ({ value: model.id, label: model.name }))}
      value={modelId ?? models[0]?.id}
      onChange={onChoose}
      isDisabled={isRunning}
      disabledMessage="Wait until Kira has finished writing."
    />
  );
}

/**
 * The month's spend, the chat's own numbers, and what to do about them.
 *
 * The month is the reading that is always there — it is what a refusal is decided
 * against — and the chat's numbers sit under it because they are the ones a person
 * can still do something about: a chat that has cost a lot is why the month is where
 * it is, and how full its window is says how much longer it can go on. Astryx's
 * `MetadataList` is what a label and its value are said with, so the lines are read
 * the same way the rest of the app's metadata is.
 *
 * It was a tooltip and is now a popover, because it holds a control: a tooltip is
 * for reading, and where there is no hover a tap cannot both open one and press
 * what is inside it. The action sits under the readings, because they are what make
 * pressing it a decision rather than a guess.
 *
 * Compacting is offered for any chat that has a session. Whether a chat is worth
 * compacting is the reader's judgement — tidying up before changing the subject is
 * a reason, and pi's own threshold is exactly what this exists to get ahead of — so
 * nothing here gates it on fullness. What cannot be compacted at all is refused, and
 * that refusal is shown where the action is.
 */
function ContextGauge({
  usage,
  chatUsage,
}: {
  usage: Usage | null;
  chatUsage: ChatUsage | null;
}): ReactNode {
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const [isCompacting, setIsCompacting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const lines = chatUsage === null ? [] : chatLines(chatUsage);

  async function compact(): Promise<void> {
    setIsCompacting(true);
    setRefusal(null);

    const result = await window.kira.compactChat();

    setIsCompacting(false);
    if (!result.ok) setRefusal(result.error);
  }

  return (
    <Popover
      // The gauge sits just left of the send button at the composer's right-hand
      // end, so the card is grown leftwards from it: centred, it would hang off the
      // window's own edge.
      alignment="end"
      label="This month's allowance and this chat's context"
      content={
        <>
          {/*
           * The month's reading is absent when the server could not be asked,
           * which is not the same as there being nothing to compact: a chat still
           * runs on the models already remembered, so the action is offered with
           * no month beside it rather than not at all.
           */}
          {usage === null ? null : (
            <>
              <MetadataList label={{ position: 'start', width: 96 }}>
                <MetadataListItem label="This month's allowance">
                  <span {...stylex.props(styles.monthValue)}>
                    {formatTokens(usage.used)} of {formatTokens(usage.allowance)}
                  </span>
                </MetadataListItem>
              </MetadataList>
              <ProgressBar
                xstyle={styles.allowance}
                // Clamped, so a month that has overspent is a bar filled to its end
                // rather than one drawn past it. The number alongside it is not clamped:
                // somebody over the line should see by how much.
                value={Math.min(usage.used, usage.allowance)}
                max={usage.allowance}
                label="This month's allowance"
                isLabelHidden
                variant={usage.warned ? 'warning' : 'accent'}
              />
            </>
          )}
          {lines.length === 0 ? null : (
            <MetadataList label={{ position: 'start', width: 96 }} xstyle={styles.chatUsage}>
              {lines.map((line) => (
                <MetadataListItem key={line.label} label={line.label}>
                  {line.value}
                </MetadataListItem>
              ))}
            </MetadataList>
          )}
          {/*
           * A chat being composed has no session and so nothing to summarise: it
           * is offered nothing rather than told, on pressing it, that no chat is
           * open. Any chat that has one is offered the action, and pi is what
           * refuses a compaction it cannot make — whether a chat is worth
           * compacting is the reader's call, not this card's.
           */}
          {chatUsage === null ? null : (
            <VStack gap={1}>
              <Button
                label="Compact now"
                size="sm"
                isLoading={isCompacting}
                clickAction={compact}
              />
              {isRunning ? (
                <Text size="sm" color="secondary">
                  Kira is working: compacting now ends the answer Kira is writing.
                </Text>
              ) : null}
              {refusal === null ? null : (
                <Text size="sm" color="secondary">
                  {refusal}
                </Text>
              )}
            </VStack>
          )}
        </>
      }
    >
      {/* The label names the control for assistive tech, so the icon inside it is
          decorative and carries none of its own. */}
      <IconButton
        label="This chat's context, and compacting it"
        icon={<Icon icon={Gauge} size="sm" />}
        variant="ghost"
        size="sm"
      />
    </Popover>
  );
}
