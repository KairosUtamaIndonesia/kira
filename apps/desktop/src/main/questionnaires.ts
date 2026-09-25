import { randomUUID } from 'node:crypto';
import { Type, type Static } from 'typebox';
import type {
  ChatEvent,
  QuestionnaireAnswer,
  QuestionnaireParams,
  QuestionnaireQuestion,
  QuestionnaireRequest,
  QuestionnaireResult,
} from '../preload/bridge.ts';

export const MAX_QUESTIONS = 4;
export const MAX_OPTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_HEADER_LENGTH = 16;
export const MAX_LABEL_LENGTH = 60;
export const MAX_NOTE_LENGTH = 10_000;

const RESERVED_LABELS = new Set(['Other', 'Type something.', 'Next']);

const optionSchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH }),
  description: Type.String(),
  preview: Type.Optional(Type.String()),
});

const questionSchema = Type.Object({
  question: Type.String({ minLength: 1, maxLength: 2_000 }),
  header: Type.String({ minLength: 1, maxLength: MAX_HEADER_LENGTH }),
  options: Type.Array(optionSchema, { minItems: MIN_OPTIONS, maxItems: MAX_OPTIONS }),
  multiSelect: Type.Optional(Type.Boolean()),
});

export const questionnaireSchema = Type.Object({
  questions: Type.Array(questionSchema, { minItems: 1, maxItems: MAX_QUESTIONS }),
});
export type QuestionnaireInput = Static<typeof questionnaireSchema>;

/** Validate semantic constraints the JSON schema cannot express. */
export function validateQuestionnaire(value: QuestionnaireInput): string | null {
  const questions = new Set<string>();
  for (const question of value.questions) {
    if (questions.has(question.question)) return 'Question text must be unique.';
    questions.add(question.question);

    const labels = new Set<string>();
    for (const option of question.options) {
      if (RESERVED_LABELS.has(option.label)) {
        return `Option labels cannot be reserved (${[...RESERVED_LABELS].join(', ')}).`;
      }
      if (labels.has(option.label)) return 'Option labels must be unique within each question.';
      labels.add(option.label);
    }
  }
  return null;
}

/** Copy only answers that agree with the questions that were actually asked. */
export function questionnaireResultIn(
  params: QuestionnaireParams,
  value: unknown,
): QuestionnaireResult | null {
  if (!isRecord(value) || typeof value.cancelled !== 'boolean' || !Array.isArray(value.answers)) {
    return null;
  }
  if (value.cancelled) return { answers: [], cancelled: true };
  if (value.answers.length > params.questions.length) return null;
  const seen = new Set<number>();
  const answers: QuestionnaireAnswer[] = [];

  for (const raw of value.answers) {
    if (!isRecord(raw) || !Number.isInteger(raw.questionIndex)) return null;
    const questionIndex = raw.questionIndex as number;
    const question = params.questions[questionIndex];
    if (question === undefined || seen.has(questionIndex)) return null;
    seen.add(questionIndex);

    const clean = answerIn(question, questionIndex, raw);
    if (clean === null) return null;
    answers.push(clean);
  }

  const globalNote = noteIn(value.globalNote);
  if (value.globalNote !== undefined && globalNote === null) return null;

  if (answers.length === 0 && globalNote === null) {
    return { answers: [], cancelled: true };
  }

  return {
    answers,
    cancelled: value.cancelled,
    ...(globalNote ? { globalNote } : {}),
  };
}

function answerIn(
  question: QuestionnaireQuestion,
  questionIndex: number,
  raw: Record<string, unknown>,
): QuestionnaireAnswer | null {
  const notes = noteIn(raw.notes);
  if (raw.notes !== undefined && notes === null) return null;
  const common = {
    questionIndex,
    question: question.question,
    ...(notes ? { notes } : {}),
  };

  if (raw.kind === 'option') {
    if (typeof raw.answer !== 'string') return null;
    const option = question.options.find((candidate) => candidate.label === raw.answer);
    if (!option) return null;
    return {
      ...common,
      kind: 'option',
      answer: option.label,
      ...(option.preview ? { preview: option.preview } : {}),
    };
  }

  if (raw.kind === 'custom') {
    if (
      typeof raw.answer !== 'string' ||
      raw.answer.trim() === '' ||
      raw.answer.length > MAX_NOTE_LENGTH
    ) {
      return null;
    }
    return { ...common, kind: 'custom', answer: raw.answer };
  }

  if (raw.kind === 'multi') {
    if (!question.multiSelect || !Array.isArray(raw.selected) || raw.selected.length === 0) {
      return null;
    }
    if (
      raw.selected.some(
        (label) =>
          typeof label !== 'string' || !question.options.some((option) => option.label === label),
      ) ||
      new Set(raw.selected).size !== raw.selected.length
    ) {
      return null;
    }
    const preview = (raw.selected as string[])
      .map((label) => question.options.find((option) => option.label === label)?.preview)
      .filter((item): item is string => item !== undefined)
      .join('\n\n');
    return {
      ...common,
      kind: 'multi',
      answer: null,
      selected: raw.selected as string[],
      ...(preview ? { preview } : {}),
    };
  }

  return null;
}

function noteIn(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > MAX_NOTE_LENGTH) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface PendingQuestionnaire {
  request: QuestionnaireRequest;
  params: QuestionnaireParams;
  resolve(result: QuestionnaireResult): void;
  reject(error: Error): void;
  signal?: AbortSignal;
  abort?: () => void;
}

/**
 * One pending interactive question per chat. The tool waits on this module;
 * the renderer receives a typed event and submits an answer by request id.
 */
export class Questionnaires {
  private readonly pending = new Map<string, PendingQuestionnaire>();
  private readonly byThread = new Map<string, string>();
  private readonly publish: (event: ChatEvent) => void;

  constructor(publish: (event: ChatEvent) => void) {
    this.publish = publish;
  }

  ask(
    threadId: string,
    params: QuestionnaireParams,
    signal?: AbortSignal,
  ): Promise<QuestionnaireResult> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.byThread.has(threadId)) {
      return Promise.reject(new Error('A question is already waiting for an answer in this chat.'));
    }

    const request: QuestionnaireRequest = {
      ...params,
      threadId,
      requestId: randomUUID(),
    };

    return new Promise<QuestionnaireResult>((resolve, reject) => {
      const pending: PendingQuestionnaire = {
        request,
        params,
        resolve,
        reject,
        ...(signal === undefined ? {} : { signal }),
      };
      if (signal !== undefined) {
        pending.abort = () => this.finish(pending, undefined, abortError());
        signal.addEventListener('abort', pending.abort, { once: true });
      }
      this.pending.set(request.requestId, pending);
      this.byThread.set(threadId, request.requestId);
      try {
        this.publish({ type: 'questionnaire-opened', ...request });
      } catch (error) {
        this.finish(pending, undefined, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  submit(threadId: string, requestId: string, value: unknown): boolean {
    const pending = this.pending.get(requestId);
    if (pending === undefined || pending.request.threadId !== threadId) return false;
    const result = questionnaireResultIn(pending.params, value);
    if (result === null) return false;
    this.finish(pending, result);
    return true;
  }

  cancel(threadId: string, requestId: string): boolean {
    const pending = this.pending.get(requestId);
    if (pending === undefined || pending.request.threadId !== threadId) return false;
    this.finish(pending, { answers: [], cancelled: true });
    return true;
  }

  current(threadId: string): QuestionnaireRequest | null {
    const requestId = this.byThread.get(threadId);
    return requestId === undefined ? null : (this.pending.get(requestId)?.request ?? null);
  }

  closeAll(): void {
    for (const pending of this.pending.values()) {
      this.finish(pending, undefined, abortError());
    }
  }

  private finish(pending: PendingQuestionnaire, result?: QuestionnaireResult, error?: Error): void {
    const { request, signal, abort } = pending;
    if (!this.pending.delete(request.requestId)) return;
    this.byThread.delete(request.threadId);
    if (signal !== undefined && abort !== undefined) {
      signal.removeEventListener('abort', abort);
    }
    try {
      this.publish({
        type: 'questionnaire-closed',
        threadId: request.threadId,
        requestId: request.requestId,
      });
    } catch {
      // A dead renderer cannot receive the close event, but the tool still must settle.
    }
    if (error !== undefined) pending.reject(error);
    else pending.resolve(result ?? { answers: [], cancelled: true });
  }
}

function abortError(): Error {
  const error = new Error('The question was interrupted because the chat stopped.');
  error.name = 'AbortError';
  return error;
}

export function questionnaireResponse(result: QuestionnaireResult): string {
  if (result.cancelled) return 'User declined to answer questions.';
  const answers = result.answers.map((answer) => {
    const value =
      answer.kind === 'multi' ? (answer.selected ?? []).join(', ') : (answer.answer ?? '');
    return [
      `- ${JSON.stringify(answer.question)}: ${JSON.stringify(value)}`,
      ...(answer.preview ? [`  Selected preview: ${answer.preview}`] : []),
      ...(answer.notes ? [`  User note: ${answer.notes}`] : []),
    ].join('\n');
  });
  if (result.globalNote) answers.push(`Global note: ${result.globalNote}`);
  if (answers.length === 0) return 'User declined to answer questions.';
  return `User has answered your questions:\n${answers.join('\n')}\nContinue with the user's answers in mind.`;
}
