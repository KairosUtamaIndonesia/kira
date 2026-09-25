/**
 * The one model-backed stage: drawing conclusions from what a chat has noticed.
 *
 * Everything else in Kira's memory is worked out from the words — the ledger
 * is a function of the turns, and the summary is a selection of the ledger. What
 * the words amount to is the part regex cannot reach, so it is asked of a model,
 * and asked once per compaction rather than once per turn: a chat is reflected on
 * when it is being summarised, not while it is being used.
 *
 * The call is made through a real pi session on Kira's own provider, with no
 * tools and a session of its own that is thrown away afterwards. That is what
 * keeps a reflection's tokens on the same path as any other call — the same
 * provider, the same Usage row, the same refusal — rather than reaching past pi
 * for a stream of its own, which would be a second way for Kira to spend a
 * person's allowance.
 *
 * Failing is ordinary here. A chat whose reflector cannot be reached still
 * compacts, so what this returns when it cannot answer is nothing, and the caller
 * decides what that costs.
 */
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import type { StoredReflection } from '../../db/threads.ts';
import type { Models } from '../models.ts';
import type { HeldObservation } from './memory.ts';

/**
 * How many conclusions one pass may add.
 *
 * A model that answers with a page of them has stopped drawing conclusions and
 * started inventing, and every one of these becomes part of what the chat is
 * told about itself. A handful is a reflection; a page is a rewrite.
 */
const AT_MOST = 5;

/**
 * What the reflector is told, which is the whole of its instructions.
 *
 * It is given no tools, so nothing here is a suggestion about how to call one:
 * every rule it has is a sentence in this prompt, including the one that says an
 * empty answer is a real answer. Most of what a chat notices is working state,
 * and a model with no way to say "nothing" will find something to say.
 */
const RULES = [
  'You keep the long memory of a chat. You are given what the chat noticed and what it has already concluded, and you draw the conclusions worth keeping.',
  'A conclusion is a durable thing a later reader must know and could not work out again from the words alone: a decision and why it was made, a constraint, a correction, what the work turned out to be.',
  'Do not restate what is already concluded, reword it, or split it. Emit only what is new.',
  'One conclusion per line, plain prose. No headings, bullets, numbering or code fences — a line is read as it stands.',
  'A conclusion must stand on its own: name the file, the command or the decision it is about rather than referring to a turn by number.',
  'Say why, not only what. A conclusion without its reason cannot be acted on.',
  'What the person asked for is authoritative; their words beat any inference.',
  'Fewer is better, and none is a real answer: most of what a chat notices is working state that will not matter later. Reply with nothing at all if nothing has settled.',
].join('\n');

/** What a thing the chat noticed looks like to the reflector. */
function noticedLine(each: HeldObservation, numberAt: ReadonlyMap<string, number>): string {
  const number = numberAt.get(each.entryId);
  const where = number === undefined ? '' : `[${number}] `;

  return `- ${where}${each.kind} ${each.relevance}: ${each.text}`;
}

/**
 * What the reflector reads: the chat's own ledger, and what it already knows.
 *
 * The relevance is carried because it is the observer's judgement of what
 * mattered, which is the closest thing to evidence the reflector has, and the
 * turn number is carried because a conclusion is drawn *about* something a
 * reader may want to go and look at. What is already concluded is shown in full:
 * a model told only to draw new conclusions, and not what the old ones were,
 * draws them again in different words.
 */
export function reflectionPrompt(
  held: readonly HeldObservation[],
  numberAt: ReadonlyMap<string, number>,
  known: readonly StoredReflection[],
): string {
  const concluded = known.length === 0 ? ['Nothing yet.'] : known.map((each) => `- ${each.text}`);

  return [
    RULES,
    '',
    '## Already concluded',
    ...concluded,
    '',
    '## Noticed',
    ...held.map((each) => noticedLine(each, numberAt)),
  ].join('\n');
}

/**
 * What the model concluded, read back as lines.
 *
 * A model writing prose reaches for the habits of prose — a heading before its
 * list, a bullet on each line, a number on the first — so the shape of the answer
 * is stripped rather than trusted. What is left is what it concluded; a line that
 * carries no words of its own is not a conclusion. A line ending in a colon is
 * dropped for the same reason: 'Here are the conclusions:' introduces them rather
 * than being one.
 */
export function conclusionsIn(answer: string): string[] {
  return answer
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#') && !line.endsWith(':'))
    .map((line) =>
      line
        .replace(/^[-*•]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .trim(),
    )
    .filter((line) => line !== '')
    .slice(0, AT_MOST);
}

/** What the reflector needs to reach a model. */
export interface ReflectorDeps {
  models: Models;
  cwd: string;
  /**
   * The model the chat itself runs on.
   *
   * Provisional. The spec has the reflector default to the cheapest model in the
   * catalog, and that cannot be worked out here yet: the catalog reaches the
   * desktop without prices (`apps/server/src/contract.ts`), so there is no cost to
   * compare. Until there is, a conclusion is drawn by the model that did the work
   * — at least the understanding the person is already reading — and #43, which
   * owns what reflects and what it costs, settles the default properly.
   *
   * A chat that has never settled a model is reflected on by whatever the pool
   * prefers, which is what booting it would have chosen too.
   */
  modelId: string | null;
  /**
   * The compaction's own abort signal, handed on so a cancelled compaction does
   * not sit waiting on a model. pi gives the hook this signal and `prompt` has no
   * place to take one, so it goes to the model runtime, which is the only part of
   * this that can take a long time.
   */
  signal?: AbortSignal;
}

/** One message in the reflector's own session, as pi holds it. */
type Reply = Awaited<
  ReturnType<typeof createAgentSessionFromServices>
>['session']['messages'][number];

/** The text of a session's last reply, which is what a reflector has said. */
function saidIn(messages: readonly Reply[]): string {
  const replies = messages.filter((message) => message.role === 'assistant');
  const last = replies[replies.length - 1];
  if (last === undefined || last.role !== 'assistant') return '';

  return last.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

/**
 * Ask a model for conclusions, in a session of its own that is thrown away.
 *
 * Throws when there is no model to ask or the call fails, because deciding what a
 * failed reflection costs is the caller's business: this runs inside pi's
 * compaction hook, where a throw would cost the whole compaction rather than the
 * conclusions.
 */
export async function askForConclusions(
  { models, cwd, modelId, signal }: ReflectorDeps,
  prompt: string,
): Promise<string[]> {
  const remembered = modelId === null ? null : await models.find(modelId);
  const choice = remembered ?? (await models.preferred());
  if (choice === null) throw new Error('Kira is not offering any models to reflect with.');

  // Built to answer one question and thrown away, so it carries none of Kira's
  // hooks and none of a chat's tools — and nothing is loaded out of the
  // directory it runs in either. That last part matters: the reflector runs in
  // the chat's own cwd, so unless context files are switched off it is handed
  // that workspace's AGENTS.md as part of its instructions, and `RULES` stops being
  // the whole of what it was told.
  const services = await createAgentSessionServices({
    cwd,
    modelRuntime: choice.runtime,
    modelRuntimeSignal: signal,
    resourceLoaderOptions: {
      noContextFiles: true,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
    },
  });
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.inMemory(cwd),
    model: choice.model,
    noTools: 'all',
  });

  try {
    await session.prompt(prompt);

    return conclusionsIn(saidIn(session.messages));
  } finally {
    session.dispose();
  }
}
