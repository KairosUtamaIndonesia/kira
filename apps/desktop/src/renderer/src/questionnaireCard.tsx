import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack } from '@astryxdesign/core/HStack';
import { Markdown } from '@astryxdesign/core/Markdown';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack } from '@astryxdesign/core/VStack';
import { borderVars, colorVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import { useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import type { QuestionnaireAnswer, QuestionnaireRequest } from '../../preload/bridge';

const MAX_ANSWER_LENGTH = 10_000;

export interface QuestionnaireDraft {
  tab: number;
  answers: Record<number, QuestionnaireAnswer>;
  customDrafts: Record<number, string>;
  notes: Record<number, string>;
  globalNote: string;
}

const styles = stylex.create({
  root: { maxWidth: 760, width: '100%', marginBlock: spacingVars['--spacing-3'] },
  option: {
    width: '100%',
    display: 'block',
    padding: spacingVars['--spacing-3'],
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'transparent',
    color: colorVars['--color-text-primary'],
    textAlign: 'start',
    cursor: 'pointer',
    ':hover': { backgroundColor: colorVars['--color-accent-muted'] },
    ':focus-visible': {
      outlineWidth: '2px',
      outlineStyle: 'solid',
      outlineColor: colorVars['--color-accent'],
      outlineOffset: '2px',
    },
  },
  optionSelected: {
    borderColor: colorVars['--color-accent'],
    backgroundColor: colorVars['--color-accent-muted'],
  },
  preview: {
    padding: spacingVars['--spacing-3'],
    borderInlineStartWidth: borderVars['--border-width'],
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: colorVars['--color-border'],
    color: colorVars['--color-text-secondary'],
  },
  questionNav: { display: 'flex', flexWrap: 'wrap', gap: spacingVars['--spacing-1'] },
  reviewItem: {
    paddingBlock: spacingVars['--spacing-2'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  actions: { justifyContent: 'space-between', flexWrap: 'wrap' },
});

function selectedFor(answer: QuestionnaireAnswer | undefined, label: string): boolean {
  if (answer?.kind === 'option') return answer.answer === label;
  return answer?.kind === 'multi' && (answer.selected ?? []).includes(label);
}

/**
 * An in-chat form for one pending question call. Its draft is kept by the window
 * under the live request id, so switching chats does not lose unfinished answers.
 */
export function QuestionnaireCard({
  request,
  draft,
  onDraftChange,
  onSubmit,
  onCancel,
}: {
  request: QuestionnaireRequest;
  draft: QuestionnaireDraft | undefined;
  onDraftChange: (requestId: string, draft: QuestionnaireDraft) => void;
  onSubmit: (
    threadId: string,
    requestId: string,
    result: {
      answers: QuestionnaireAnswer[];
      cancelled: false;
      globalNote?: string;
    },
  ) => Promise<string | null>;
  onCancel: (threadId: string, requestId: string) => Promise<string | null>;
}) {
  const [tab, setTab] = useState(() => draft?.tab ?? 0);
  const [answers, setAnswers] = useState<Record<number, QuestionnaireAnswer>>(
    () => draft?.answers ?? {},
  );
  const [customDrafts, setCustomDrafts] = useState<Record<number, string>>(
    () => draft?.customDrafts ?? {},
  );
  const [notes, setNotes] = useState<Record<number, string>>(() => draft?.notes ?? {});
  const [globalNote, setGlobalNote] = useState(() => draft?.globalNote ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewTab = request.questions.length;
  const reviewing = tab === reviewTab;
  const question = reviewing ? undefined : request.questions[tab];
  const answer = answers[tab];
  const unanswered = request.questions.filter((_, index) => answers[index] === undefined).length;

  function saveDraft(change: Partial<QuestionnaireDraft>): void {
    onDraftChange(request.requestId, {
      answers,
      customDrafts,
      notes,
      globalNote,
      tab,
      ...change,
    });
  }

  function goToTab(next: number): void {
    setTab(next);
    saveDraft({ tab: next });
  }

  function answerWithNotes(index: number, next: QuestionnaireAnswer): QuestionnaireAnswer {
    const note = notes[index]?.trim();
    return note ? { ...next, notes: note } : next;
  }

  function chooseOption(index: number, label: string): void {
    const currentQuestion = request.questions[index];
    if (!currentQuestion) return;
    const previous = answers[index];
    if (currentQuestion.multiSelect) {
      const selected = previous?.kind === 'multi' ? [...(previous.selected ?? [])] : [];
      const next = selected.includes(label)
        ? selected.filter((item) => item !== label)
        : [...selected, label];
      if (next.length === 0) {
        const { [index]: _removed, ...remaining } = answers;
        setAnswers(remaining);
        saveDraft({ answers: remaining });
        return;
      }
      const preview = next
        .map(
          (selectedLabel) =>
            currentQuestion.options.find((item) => item.label === selectedLabel)?.preview,
        )
        .filter((item): item is string => item !== undefined)
        .join('\n\n');
      const updated = {
        ...answers,
        [index]: answerWithNotes(index, {
          questionIndex: index,
          question: currentQuestion.question,
          kind: 'multi',
          answer: null,
          selected: next,
          ...(preview ? { preview } : {}),
        }),
      };
      setAnswers(updated);
      saveDraft({ answers: updated });
      return;
    }
    const option = currentQuestion.options.find((item) => item.label === label);
    if (!option) return;
    const updated = {
      ...answers,
      [index]: answerWithNotes(index, {
        questionIndex: index,
        question: currentQuestion.question,
        kind: 'option',
        answer: option.label,
        ...(option.preview ? { preview: option.preview } : {}),
      }),
    };
    setAnswers(updated);
    saveDraft({ answers: updated });
  }

  function chooseCustom(index: number): void {
    const currentQuestion = request.questions[index];
    const text = customDrafts[index]?.trim();
    if (!currentQuestion || !text) return;
    const updated = {
      ...answers,
      [index]: answerWithNotes(index, {
        questionIndex: index,
        question: currentQuestion.question,
        kind: 'custom',
        answer: customDrafts[index] ?? '',
      }),
    };
    setAnswers(updated);
    saveDraft({ answers: updated });
  }

  function updateCustomDraft(index: number, value: string): void {
    const updated = { ...customDrafts, [index]: value };
    setCustomDrafts(updated);
    saveDraft({ customDrafts: updated });
  }

  function updateNote(index: number, value: string): void {
    const updatedNotes = { ...notes, [index]: value };
    setNotes(updatedNotes);
    const previous = answers[index];
    if (previous) {
      const { notes: _notes, ...rest } = previous;
      const updatedAnswers = {
        ...answers,
        [index]: value.trim() ? { ...rest, notes: value } : rest,
      };
      setAnswers(updatedAnswers);
      saveDraft({ notes: updatedNotes, answers: updatedAnswers });
    } else {
      saveDraft({ notes: updatedNotes });
    }
  }

  function updateGlobalNote(value: string): void {
    setGlobalNote(value);
    saveDraft({ globalNote: value });
  }

  async function submit(): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      setError(
        await onSubmit(request.threadId, request.requestId, {
          answers: Object.values(answers).sort(
            (left, right) => left.questionIndex - right.questionIndex,
          ),
          cancelled: false,
          ...(globalNote.trim() ? { globalNote } : {}),
        }),
      );
    } catch {
      setError('Could not submit the answers. Try again.');
    } finally {
      setPending(false);
    }
  }

  async function cancel(): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      setError(await onCancel(request.threadId, request.requestId));
    } catch {
      setError('Could not cancel the questions. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card padding={3} xstyle={styles.root}>
      <VStack gap={3}>
        <HStack justify="between" align="center" gap={2}>
          <Text type="label" weight="medium">
            Kira has a question
          </Text>
          <Badge
            label={reviewing ? 'Review' : `${tab + 1} of ${request.questions.length}`}
            variant="info"
          />
        </HStack>
        <nav aria-label="Question steps" {...stylex.props(styles.questionNav)}>
          {request.questions.map((item, index) => (
            <Button
              key={`${index}:${item.header}`}
              label={item.header}
              size="sm"
              variant={tab === index ? 'primary' : 'secondary'}
              onClick={() => goToTab(index)}
            />
          ))}
          <Button
            label="Review"
            size="sm"
            variant={reviewing ? 'primary' : 'secondary'}
            onClick={() => goToTab(reviewTab)}
          />
        </nav>

        {question ? (
          <VStack gap={2}>
            <Text type="body" weight="medium">
              {question.question}
            </Text>
            <VStack gap={1}>
              {question.options.map((option) => {
                const selected = selectedFor(answer, option.label);
                return (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={selected}
                    {...stylex.props(styles.option, selected && styles.optionSelected)}
                    onClick={() => chooseOption(tab, option.label)}
                  >
                    <Text type="label" weight="medium">
                      {option.label}
                      {selected ? ' · Selected' : ''}
                    </Text>
                    <Text type="supporting" color="secondary">
                      {option.description}
                    </Text>
                  </button>
                );
              })}
            </VStack>
            {answer?.preview ? (
              <div {...stylex.props(styles.preview)}>
                <Markdown>{answer.preview}</Markdown>
              </div>
            ) : null}
            <VStack gap={1}>
              <TextArea
                label="Your own answer"
                value={customDrafts[tab] ?? ''}
                onChange={(value) => updateCustomDraft(tab, value)}
                rows={3}
                maxLength={MAX_ANSWER_LENGTH}
              />
              <Button
                label="Use written answer"
                size="sm"
                variant={answer?.kind === 'custom' ? 'primary' : 'secondary'}
                isDisabled={!customDrafts[tab]?.trim()}
                onClick={() => chooseCustom(tab)}
              />
            </VStack>
            <TextArea
              label="Note on this answer"
              value={notes[tab] ?? ''}
              onChange={(value) => updateNote(tab, value)}
              rows={2}
              maxLength={MAX_ANSWER_LENGTH}
            />
          </VStack>
        ) : (
          <VStack gap={2}>
            <Text type="body" weight="medium">
              Review your answers
            </Text>
            {request.questions.map((item, index) => (
              <div key={`${index}:${item.question}`} {...stylex.props(styles.reviewItem)}>
                <Text type="label" weight="medium">
                  {item.question}
                </Text>
                <Text type="supporting" color="secondary">
                  {answers[index]
                    ? answers[index]?.kind === 'multi'
                      ? answers[index]?.selected?.join(', ')
                      : answers[index]?.answer
                    : 'Not answered'}
                </Text>
                {notes[index] ? (
                  <Text type="supporting" color="secondary">
                    Note: {notes[index]}
                  </Text>
                ) : null}
              </div>
            ))}
            {unanswered > 0 ? (
              <Text type="supporting" color="secondary">
                {unanswered} unanswered. You can submit partial answers.
              </Text>
            ) : null}
            <TextArea
              label="Note for the whole questionnaire"
              value={globalNote}
              onChange={updateGlobalNote}
              rows={3}
              maxLength={MAX_ANSWER_LENGTH}
            />
          </VStack>
        )}

        {error ? (
          <Text type="supporting" color="secondary">
            {error}
          </Text>
        ) : null}
        <HStack gap={2} xstyle={styles.actions}>
          <HStack gap={2}>
            {!reviewing && tab > 0 ? (
              <Button label="Previous" variant="secondary" onClick={() => goToTab(tab - 1)} />
            ) : null}
            {!reviewing && tab < reviewTab - 1 ? (
              <Button label="Next" variant="secondary" onClick={() => goToTab(tab + 1)} />
            ) : null}
            {!reviewing ? (
              <Button
                label="Review answers"
                variant="secondary"
                onClick={() => goToTab(reviewTab)}
              />
            ) : null}
          </HStack>
          <HStack gap={2}>
            <Button
              label="Cancel"
              variant="ghost"
              isDisabled={pending}
              onClick={() => void cancel()}
            />
            <Button
              label={pending ? 'Sending…' : 'Submit answers'}
              variant="primary"
              isLoading={pending}
              isDisabled={pending}
              onClick={() => void submit()}
            />
          </HStack>
        </HStack>
      </VStack>
    </Card>
  );
}
