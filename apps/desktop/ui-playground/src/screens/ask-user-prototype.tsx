// Three chat-native Ask user layouts for the same questionnaire, switchable with ?variant=A|B|C.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { TextArea } from '@astryxdesign/core/TextArea';

type Variant = 'A' | 'B' | 'C';
type Answer = string | string[];

const variants: { id: Variant; name: string }[] = [
  { id: 'A', name: 'One at a time' },
  { id: 'B', name: 'All together' },
  { id: 'C', name: 'In the conversation' },
];

const questions = [
  {
    header: 'Scope',
    prompt: 'Which part of Kira should this design explore first?',
    multiSelect: false,
    options: [
      { label: 'The chat', description: 'Messages, composer, and the conversation rail.' },
      { label: 'The Workbench', description: 'Files and chat context beside the conversation.' },
      { label: 'Project Work', description: 'Tickets, blockers, and review.' },
    ],
  },
  {
    header: 'Priority',
    prompt: 'What should the Ask user experience make easiest?',
    multiSelect: true,
    options: [
      { label: 'Answer quickly', description: 'Keep the common path short.' },
      { label: 'Keep chat context', description: 'Make it clear what Kira is asking and why.' },
      { label: 'Explain a choice', description: 'Give room to add a note or a different answer.' },
    ],
  },
  {
    header: 'Unanswered',
    prompt: 'What should happen when someone skips a question?',
    multiSelect: false,
    options: [
      { label: 'Send partial answers', description: 'Let Kira continue with what is known.' },
      { label: 'Ask later', description: 'Leave the skipped question for another turn.' },
      {
        label: 'Wait for every answer',
        description: 'Keep the request open until it is complete.',
      },
    ],
  },
];

function variantFromUrl(): Variant {
  const value = new URLSearchParams(window.location.search).get('variant');
  return variants.find((variant) => variant.id === value)?.id ?? 'A';
}

function answerText(answer: Answer | undefined): string {
  if (Array.isArray(answer)) return answer.join(', ');
  return answer ?? 'Not answered';
}

export function AskUserPrototype() {
  const [variant, setVariant] = useState(variantFromUrl);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, Answer>>({ 0: 'The chat' });
  const [customDrafts, setCustomDrafts] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [globalNote, setGlobalNote] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [status, setStatus] = useState('');

  const unanswered = questions.length - Object.keys(answers).length;
  const current = questions[questionIndex];

  function changeVariant(next: Variant) {
    setVariant(next);
    const url = new URL(window.location.href);
    url.searchParams.set('variant', next);
    window.history.replaceState(null, '', url);
  }

  function cycleVariant(direction: -1 | 1) {
    const index = variants.findIndex((item) => item.id === variant);
    const next = (index + direction + variants.length) % variants.length;
    changeVariant(variants[next]!.id);
  }

  function onPrototypeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.matches('input, textarea, select, [contenteditable="true"]')
    ) {
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      cycleVariant(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  function choose(index: number, label: string) {
    const question = questions[index];
    if (!question) return;
    setStatus('');
    setAnswers((previous) => {
      if (!question.multiSelect) return { ...previous, [index]: label };
      const selected = Array.isArray(previous[index]) ? (previous[index] as string[]) : [];
      const next = selected.includes(label)
        ? selected.filter((item) => item !== label)
        : [...selected, label];
      const updated = { ...previous };
      if (next.length) updated[index] = next;
      else delete updated[index];
      return updated;
    });
  }

  function useWrittenAnswer(index: number) {
    const answer = customDrafts[index]?.trim();
    if (!answer) return;
    setAnswers((previous) => ({ ...previous, [index]: answer }));
    setStatus('');
  }

  function answerControl(index: number) {
    const question = questions[index];
    if (!question) return null;
    const answer = answers[index];
    const selected = (label: string) =>
      Array.isArray(answer) ? answer.includes(label) : answer === label;

    return (
      <>
        <div aria-label="Answer choices" className="ask-options" role="group">
          {question.options.map((option) => (
            <button
              aria-pressed={selected(option.label)}
              className={`ask-option${selected(option.label) ? ' is-selected' : ''}`}
              key={option.label}
              onClick={() => choose(index, option.label)}
              type="button"
            >
              <span className="ask-option-mark" aria-hidden="true" />
              <span className="ask-option-copy">
                <span className="ask-option-title">{option.label}</span>
                <span className="ask-option-description">{option.description}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="ask-field">
          <TextArea
            label="Your own answer"
            value={customDrafts[index] ?? ''}
            onChange={(value) => setCustomDrafts((drafts) => ({ ...drafts, [index]: value }))}
            rows={2}
          />
        </div>
        <button className="ask-text-action" onClick={() => useWrittenAnswer(index)} type="button">
          Use written answer
        </button>
        <div className="ask-field ask-note-field">
          <TextArea
            label="Note on this answer"
            value={notes[index] ?? ''}
            onChange={(value) => setNotes((currentNotes) => ({ ...currentNotes, [index]: value }))}
            rows={2}
          />
          <span className="optional-label">Optional</span>
        </div>
      </>
    );
  }

  function reviewContent() {
    return (
      <div className="ask-review">
        <h3>Review your answers</h3>
        {questions.map((question, index) => (
          <button
            className="ask-review-row"
            key={question.header}
            onClick={() => {
              setQuestionIndex(index);
              setReviewing(false);
            }}
            type="button"
          >
            <span className="ask-review-question">{question.prompt}</span>
            <span className={answers[index] ? 'ask-review-answer' : 'ask-review-answer is-empty'}>
              {answerText(answers[index])}
            </span>
            {notes[index] ? <span className="ask-review-note">Note: {notes[index]}</span> : null}
          </button>
        ))}
        {unanswered ? (
          <p className="ask-partial-note">
            {unanswered} {unanswered === 1 ? 'question is' : 'questions are'} unanswered. You can
            still send partial answers.
          </p>
        ) : null}
        <div className="ask-field">
          <TextArea
            label="Note for the whole questionnaire"
            value={globalNote}
            onChange={setGlobalNote}
            rows={2}
          />
          <span className="optional-label">Optional</span>
        </div>
      </div>
    );
  }

  function finish(action: 'sent' | 'cancelled') {
    setStatus(
      action === 'sent'
        ? `Sent ${Object.keys(answers).length} answer${Object.keys(answers).length === 1 ? '' : 's'} to Kira · prototype only`
        : 'Cancelled · prototype only',
    );
  }

  function footer() {
    return (
      <footer className="ask-actions">
        <span className="ask-remaining">
          {unanswered
            ? `${unanswered} unanswered · partial answers are okay`
            : 'All questions answered'}
        </span>
        <div className="ask-action-buttons">
          {reviewing ? (
            <button className="ask-secondary" onClick={() => setReviewing(false)} type="button">
              Back to questions
            </button>
          ) : (
            <button className="ask-secondary" onClick={() => setReviewing(true)} type="button">
              Review answers
            </button>
          )}
          <button className="ask-cancel" onClick={() => finish('cancelled')} type="button">
            Cancel
          </button>
          <button className="ask-primary" onClick={() => finish('sent')} type="button">
            Send answers
          </button>
        </div>
      </footer>
    );
  }

  function variantA() {
    return (
      <section aria-label="One question at a time" className="ask-variant ask-step">
        <div className="ask-step-head">
          <span>
            Question {questionIndex + 1} of {questions.length}
          </span>
          <div
            aria-label={`${questionIndex + 1} of ${questions.length} questions`}
            className="ask-progress"
          >
            {questions.map((question, index) => (
              <button
                aria-label={`Go to ${question.header}`}
                aria-current={index === questionIndex ? 'step' : undefined}
                className={answers[index] ? 'is-answered' : ''}
                key={question.header}
                onClick={() => setQuestionIndex(index)}
                type="button"
              />
            ))}
          </div>
        </div>
        {reviewing ? (
          reviewContent()
        ) : (
          <div className="ask-active-question">
            <div className="ask-question-copy">
              <h3>{current?.prompt}</h3>
              <p>
                {current?.multiSelect
                  ? 'Choose any that fit.'
                  : 'Choose one, or write your own answer.'}
              </p>
            </div>
            {answerControl(questionIndex)}
          </div>
        )}
        {!reviewing ? (
          <div className="ask-step-nav">
            <button
              className="ask-secondary"
              disabled={questionIndex === 0}
              onClick={() => setQuestionIndex((index) => Math.max(0, index - 1))}
              type="button"
            >
              Previous
            </button>
            <button
              className="ask-secondary"
              disabled={questionIndex === questions.length - 1}
              onClick={() => setQuestionIndex((index) => Math.min(questions.length - 1, index + 1))}
              type="button"
            >
              Next question
            </button>
          </div>
        ) : null}
        {footer()}
      </section>
    );
  }

  function variantB() {
    return (
      <section aria-label="All questions together" className="ask-variant ask-all-together">
        <div className="ask-batch-heading">
          <h3>{reviewing ? 'Review your answers' : 'A few questions before I start'}</h3>
          <p>Answer what you can. You can send the rest later.</p>
        </div>
        {reviewing ? (
          reviewContent()
        ) : (
          <div className="ask-question-list">
            {questions.map((question, index) => (
              <fieldset className="ask-question-group" key={question.header}>
                <legend>
                  <span>{question.header}</span>
                  <span>{answers[index] ? 'Answered' : 'Not answered'}</span>
                </legend>
                <h4>{question.prompt}</h4>
                {answerControl(index)}
              </fieldset>
            ))}
          </div>
        )}
        {footer()}
      </section>
    );
  }

  function variantC() {
    return (
      <section aria-label="Questions in the conversation" className="ask-variant ask-conversation">
        <div className="ask-transcript">
          <p className="ask-prior-message">
            I’ve got a few questions so I can shape this around how you want to work.
          </p>
          {questions.map((question, index) => (
            <div className="ask-turn" key={question.header}>
              <button
                className="ask-transcript-question"
                onClick={() => {
                  setQuestionIndex(index);
                  setReviewing(false);
                }}
                type="button"
              >
                <span className="ask-kira-mark" aria-hidden="true">
                  K
                </span>
                <span>{question.prompt}</span>
                <span className="ask-turn-state">{answers[index] ? 'Answered' : 'Waiting'}</span>
              </button>
              {answers[index] ? (
                <div className="ask-user-reply">
                  <span>{answerText(answers[index])}</span>
                  {notes[index] ? <small>{notes[index]}</small> : null}
                </div>
              ) : null}
              {!reviewing && questionIndex === index ? (
                <div className="ask-inline-answer">
                  <p>
                    {question.multiSelect
                      ? 'Choose any that fit.'
                      : 'Choose one, or write your own answer.'}
                  </p>
                  {answerControl(index)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {reviewing ? reviewContent() : null}
        {footer()}
      </section>
    );
  }

  const variantView = variant === 'A' ? variantA() : variant === 'B' ? variantB() : variantC();

  return (
    <div className="ask-prototype" onKeyDown={onPrototypeKeyDown}>
      <div aria-label="Ask user prototype preview" className="ask-prototype-scroll" tabIndex={0}>
        <div className="ask-demo-label">Example questions · nothing is sent</div>
        <div className="ask-conversation-context">
          <span className="ask-kira-mark" aria-hidden="true">
            K
          </span>
          <p>Before I sketch a direction, I need a little more context from you.</p>
        </div>
        {variantView}
        {status ? (
          <p aria-live="polite" className="ask-status">
            {status}
          </p>
        ) : null}

        <details className="ask-state-inspector" open>
          <summary>Draft state · local to this preview</summary>
          <ul>
            {questions.map((question, index) => (
              <li key={question.header}>
                <strong>{question.header}:</strong> {answerText(answers[index])}
                {customDrafts[index] ? <span> · written draft: {customDrafts[index]}</span> : null}
                {notes[index] ? <span> · note: {notes[index]}</span> : null}
              </li>
            ))}
            <li>
              <strong>Questionnaire note:</strong> {globalNote || 'None'}
            </li>
            <li>
              <strong>Progress:</strong> {Object.keys(answers).length} answered, {unanswered}{' '}
              unanswered
            </li>
          </ul>
        </details>
      </div>

      <nav aria-label="Prototype variants" className="ask-variant-switcher">
        <button aria-label="Previous variant" onClick={() => cycleVariant(-1)} type="button">
          <ChevronLeft size={16} />
        </button>
        <span>
          {variant} · {variants.find((item) => item.id === variant)?.name}
        </span>
        <button aria-label="Next variant" onClick={() => cycleVariant(1)} type="button">
          <ChevronRight size={16} />
        </button>
      </nav>
    </div>
  );
}
