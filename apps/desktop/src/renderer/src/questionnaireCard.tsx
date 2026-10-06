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
  customSelected: Record<number, boolean>;
  globalNote: string;
}

const styles = stylex.create({
  root: { maxWidth: 760, width: '100%', marginBlock: spacingVars['--spacing-3'] },
  option: {
    width: '100%',
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacingVars['--spacing-2'],
    paddingBlock: spacingVars['--spacing-2'],
    paddingInline: spacingVars['--spacing-2'],
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colorVars['--color-text-primary'],
    textAlign: 'start',
    cursor: 'pointer',
    ':hover': { backgroundColor: colorVars['--color-background-muted'] },
    ':focus-visible': {
      outlineWidth: '2px',
      outlineStyle: 'solid',
      outlineColor: colorVars['--color-accent'],
      outlineOffset: '2px',
    },
  },
  optionMark: {
    width: 15,
    height: 15,
    flexShrink: 0,
    marginTop: 2,
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border-emphasized'],
    borderRadius: '50%',
  },
  optionMarkSelected: {
    borderWidth: '4px',
    borderColor: colorVars['--color-accent'],
  },
  optionCopy: { display: 'grid', gap: spacingVars['--spacing-1'] },
  optionTitle: {
    fontSize: 'var(--text-body-size)',
    lineHeight: 'var(--text-body-leading)',
    fontWeight: 550,
  },
  optionDescription: {
    color: colorVars['--color-text-secondary'],
    fontSize: 'var(--text-body-size)',
    lineHeight: 'var(--text-body-leading)',
  },
  badge: {
    fontSize: 'var(--text-body-size)',
    lineHeight: 'var(--text-body-leading)',
  },
  textArea: {
    borderColor: 'transparent',
    backgroundColor: 'var(--color-background-surface)',
    fontSize: 'var(--text-body-size)',
    lineHeight: 'var(--text-body-leading)',
  },
  preview: {
    padding: spacingVars['--spacing-3'],
    borderInlineStartWidth: borderVars['--border-width'],
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: colorVars['--color-border'],
    color: colorVars['--color-text-secondary'],
  },
  reviewAnswer: {
    display: 'grid',
    width: '100%',
    gap: spacingVars['--spacing-1'],
    paddingBlock: spacingVars['--spacing-2'],
    fontSize: 'var(--text-body-size)',
    lineHeight: 'var(--text-body-leading)',
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colorVars['--color-text-secondary'],
    textAlign: 'start',
    cursor: 'pointer',
    ':hover': { color: colorVars['--color-text-primary'] },
    ':focus-visible': {
      outlineWidth: '2px',
      outlineStyle: 'solid',
      outlineColor: colorVars['--color-accent'],
      outlineOffset: '2px',
    },
  },
  reviewQuestion: { color: colorVars['--color-text-primary'] },
  reviewItem: { paddingBlock: spacingVars['--spacing-2'] },
  reviewNote: { marginTop: spacingVars['--spacing-2'] },
  tabNav: { display: 'flex', flexWrap: 'wrap', gap: spacingVars['--spacing-1'] },
  section: { maxWidth: 650, width: '100%' },
  questionOptions: { gap: 0 },
  questionPrompt: { marginBlockEnd: spacingVars['--spacing-2'] },
  writeIn: { marginTop: spacingVars['--spacing-2'] },
  review: { width: '100%' },
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
  const [customSelected, setCustomSelected] = useState<Record<number, boolean>>(
    () => draft?.customSelected ?? {},
  );
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
      customSelected,
      globalNote,
      tab,
      ...change,
    });
  }

  function goToTab(next: number): void {
    setTab(next);
    saveDraft({ tab: next });
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
      const updated: Record<number, QuestionnaireAnswer> = {
        ...answers,
        [index]: {
          questionIndex: index,
          question: currentQuestion.question,
          kind: 'multi',
          answer: null,
          selected: next,
          ...(preview ? { preview } : {}),
        },
      };
      const updatedCustomSelected = { ...customSelected, [index]: false };
      setAnswers(updated);
      setCustomSelected(updatedCustomSelected);
      saveDraft({ answers: updated, customSelected: updatedCustomSelected });
      return;
    }
    const option = currentQuestion.options.find((item) => item.label === label);
    if (!option) return;
    const updated: Record<number, QuestionnaireAnswer> = {
      ...answers,
      [index]: {
        questionIndex: index,
        question: currentQuestion.question,
        kind: 'option',
        answer: option.label,
        ...(option.preview ? { preview: option.preview } : {}),
      },
    };
    const updatedCustomSelected = { ...customSelected, [index]: false };
    setAnswers(updated);
    setCustomSelected(updatedCustomSelected);
    saveDraft({ answers: updated, customSelected: updatedCustomSelected });
  }

  function chooseCustom(index: number): void {
    const currentQuestion = request.questions[index];
    if (!currentQuestion) return;
    const selected = !customSelected[index];
    const updatedSelection = { ...customSelected, [index]: selected };
    setCustomSelected(updatedSelection);
    const text = customDrafts[index]?.trim();
    const updatedAnswers = { ...answers };
    if (selected && text) {
      updatedAnswers[index] = {
        questionIndex: index,
        question: currentQuestion.question,
        kind: 'custom',
        answer: customDrafts[index] ?? '',
      };
    } else if (!selected || !text) {
      delete updatedAnswers[index];
    }
    setAnswers(updatedAnswers);
    saveDraft({ customSelected: updatedSelection, answers: updatedAnswers });
  }

  function updateCustomDraft(index: number, value: string): void {
    const updated = { ...customDrafts, [index]: value };
    setCustomDrafts(updated);
    const currentQuestion = request.questions[index];
    const updatedAnswers = { ...answers };
    if (customSelected[index] && currentQuestion && value.trim()) {
      updatedAnswers[index] = {
        questionIndex: index,
        question: currentQuestion.question,
        kind: 'custom',
        answer: value,
      };
    } else if (customSelected[index]) {
      delete updatedAnswers[index];
    }
    setAnswers(updatedAnswers);
    saveDraft({ customDrafts: updated, answers: updatedAnswers });
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
    <Card className="questionnaire-card" padding={3} xstyle={styles.root}>
      <VStack gap={3}>
        <HStack justify="between" align="center" gap={2}>
          <Text type="label" weight="medium">
            Kira has a question
          </Text>
          <Badge
            label={reviewing ? 'Review' : `${tab + 1} of ${request.questions.length}`}
            variant="info"
            xstyle={styles.badge}
          />
        </HStack>
        <nav aria-label="Question steps" {...stylex.props(styles.tabNav)}>
          {request.questions.map((item, index) => (
            <Button
              key={`${index}:${item.header}`}
              label={item.header}
              size="sm"
              variant={tab === index ? 'primary' : 'ghost'}
              onClick={() => goToTab(index)}
            />
          ))}
          <Button
            label="Review"
            size="sm"
            variant={reviewing ? 'primary' : 'ghost'}
            onClick={() => goToTab(reviewTab)}
          />
        </nav>

        {question ? (
          <VStack gap={2} xstyle={styles.section}>
            <Text type="body" weight="medium">
              {question.question}
            </Text>
            <Text type="body" color="secondary">
              {question.multiSelect
                ? 'Choose any that fit.'
                : 'Choose one, or write your own answer.'}
            </Text>
            <VStack gap={0}>
              {question.options.map((option) => {
                const selected = selectedFor(answer, option.label);
                return (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={selected}
                    {...stylex.props(styles.option)}
                    onClick={() => chooseOption(tab, option.label)}
                  >
                    <span
                      aria-hidden="true"
                      {...stylex.props(styles.optionMark, selected && styles.optionMarkSelected)}
                    />
                    <span {...stylex.props(styles.optionCopy)}>
                      <span {...stylex.props(styles.optionTitle)}>{option.label}</span>
                      <span {...stylex.props(styles.optionDescription)}>{option.description}</span>
                    </span>
                  </button>
                );
              })}
            </VStack>
            {answer?.preview ? (
              <div {...stylex.props(styles.preview)}>
                <Markdown>{answer.preview}</Markdown>
              </div>
            ) : null}
            <button
              type="button"
              aria-pressed={customSelected[tab] ?? false}
              {...stylex.props(styles.option)}
              onClick={() => chooseCustom(tab)}
            >
              <span
                aria-hidden="true"
                {...stylex.props(
                  styles.optionMark,
                  customSelected[tab] && styles.optionMarkSelected,
                )}
              />
              <span {...stylex.props(styles.optionTitle)}>Your own answer</span>
            </button>
            {customSelected[tab] ? (
              <div {...stylex.props(styles.writeIn)}>
                <TextArea
                  label="Your own answer"
                  isLabelHidden
                  placeholder="Type your answer…"
                  xstyle={styles.textArea}
                  value={customDrafts[tab] ?? ''}
                  onChange={(value) => updateCustomDraft(tab, value)}
                  rows={2}
                  maxLength={MAX_ANSWER_LENGTH}
                />
              </div>
            ) : null}
          </VStack>
        ) : (
          <VStack gap={2} xstyle={styles.review}>
            <Text type="body" weight="medium">
              Review your answers
            </Text>
            {request.questions.map((item, index) => (
              <button
                key={`${index}:${item.question}`}
                type="button"
                {...stylex.props(styles.reviewAnswer, styles.reviewItem)}
                onClick={() => goToTab(index)}
              >
                <span {...stylex.props(styles.reviewQuestion)}>{item.question}</span>
                <span>
                  {answers[index]
                    ? answers[index]?.kind === 'multi'
                      ? answers[index]?.selected?.join(', ')
                      : answers[index]?.answer
                    : customSelected[index]
                      ? customDrafts[index]?.trim() || 'Your own answer · not answered'
                      : 'Not answered'}
                </span>
              </button>
            ))}
            <TextArea
              label="Anything else for Kira?"
              isOptional
              xstyle={styles.textArea}
              value={globalNote}
              onChange={updateGlobalNote}
              rows={3}
              maxLength={MAX_ANSWER_LENGTH}
            />
          </VStack>
        )}

        {error ? (
          <Text type="body" color="secondary">
            {error}
          </Text>
        ) : null}
        <HStack gap={2} xstyle={styles.actions}>
          <Text type="body" color="secondary">
            {unanswered > 0
              ? `${unanswered} unanswered · partial answers are okay`
              : 'All questions answered'}
          </Text>
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
