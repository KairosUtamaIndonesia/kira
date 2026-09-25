import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import type {
  ChatEvent,
  ChatMessage,
  ChatSummary,
  ChatPart,
  ChatTranscript,
  ToolImage,
  ToolRun,
} from '../../preload/bridge.ts';
import { ThreadStore } from '../db/threads.ts';
import { tempDir } from '../test-support/temp.ts';
import {
  forkConversation,
  listChats,
  resumeConversation,
  startConversation,
} from './conversations.ts';
import type { Conversation } from './conversations.ts';
import { createThread, openThread, type PiThread } from './storage.ts';
import { kiraModels, type Models } from './models.ts';

// Hermetic: pi reads `PI_CODING_AGENT_DIR` for credentials and `HOME` for the
// global skills source, so neither leaks in from the developer's machine.
process.env['HOME'] = tempDir('kira-chat-home-');
process.env['PI_CODING_AGENT_DIR'] = tempDir('kira-chat-agent-dir-');

/**
 * The models these conversations run on: what a launch that has asked before
 * remembers. Written down rather than fetched, because what a session runs on is
 * the server's to say and asking it is `models.test.ts`'s job — here it only has
 * to be there for a session to boot.
 *
 * `server` is where pi would send a turn, and nothing in this file reaches it
 * except the case that means to.
 */
function rememberedModels(server = 'http://localhost:4100'): Models {
  const cache = join(tempDir('kira-chat-models-'), 'models.json');
  writeFileSync(cache, JSON.stringify({ models: [{ id: 'served-model', name: 'Served Model' }] }));

  return kiraModels({
    server,
    cachePath: cache,
    token: async () => 'device-key',
    catalog: async () => ({ kind: 'unavailable' }),
  });
}

const MODELS = rememberedModels();

/** A message as pi accepts it, so a test fixture needs no new dependency to build one. */
type StoredMessage = Parameters<SessionManager['appendMessage']>[0];

type AssistantPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | {
      type: 'toolCall';
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    };

/**
 * A message as pi accepts it, so a test fixture needs no new dependency to build
 * one. What the provider reported the answer cost is written in as well, because
 * the chat's own spend is read back out of it: nothing, unless a case says.
 */
function assistantMessage(
  content: AssistantPart[],
  timestamp: number,
  cost: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } = {},
): StoredMessage {
  return {
    role: 'assistant',
    content,
    api: 'openai-codex-responses',
    provider: 'openai-codex',
    model: 'gpt-5.6-luna',
    usage: {
      input: cost.input ?? 0,
      output: cost.output ?? 0,
      cacheRead: cost.cacheRead ?? 0,
      cacheWrite: cost.cacheWrite ?? 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp,
  };
}

const text = (words: string): ChatPart => ({ type: 'text', text: words });

/**
 * One tool run as a case reads it: how long it took is written as whether there
 * is a time at all. A duration is a real elapsed time between two entries pi
 * stamps as it writes them, which no test can pin down.
 */
type ShownRun = Omit<ToolRun, 'durationMs'> & { durationMs: 'timed' | null };

/** One part as a case reads it. */
type ShownPart =
  | { type: 'text'; text: string }
  | { type: 'work'; reasoning: string | null; durationMs: 'timed' | null; calls: ShownRun[] }
  | { type: 'glossary'; change: Extract<ChatPart, { type: 'glossary' }>['change'] }
  | {
      type: 'compaction';
      /** pi stamps this when it writes the entry, so it is recorded rather than asserted. */
      at: 'recorded';
      lastWords: string | null;
      messages: number;
      reconstruction: string;
    };

/** A tool she ran, as the assistant asks for it. */
const ran = (id: string, name: string, args: Record<string, unknown>): AssistantPart => ({
  type: 'toolCall',
  id,
  name,
  arguments: args,
});

/** What she thought before acting, or before answering. */
const thought = (words: string): AssistantPart => ({ type: 'thinking', thinking: words });

/**
 * What a tool answered, stored the way pi stores it: an entry of its own, after
 * the reply that asked for it, paired to the call by id.
 */
const answered =
  (
    id: string,
    name: string,
    result: {
      isError?: boolean;
      diff?: string;
      said?: string;
      details?: Record<string, unknown>;
      image?: ToolImage;
    } = {},
  ) =>
  (thread: PiThread): void => {
    thread.sessionManager.appendMessage({
      role: 'toolResult',
      toolCallId: id,
      toolName: name,
      content:
        result.image === undefined
          ? [{ type: 'text', text: result.said ?? 'done' }]
          : [{ type: 'image', data: result.image.data, mimeType: result.image.mimeType }],
      isError: result.isError ?? false,
      timestamp: 3,
      ...(result.diff === undefined && result.details === undefined
        ? {}
        : {
            details: {
              ...(result.diff === undefined
                ? {}
                : { diff: result.diff, patch: 'the same changes, as a patch' }),
              ...(result.details ?? {}),
            },
          }),
    });
  };

/** A call nothing has come back for yet. */
const waiting = (name: string, target: string): ShownRun => ({
  name,
  target,
  status: 'running',
  durationMs: null,
  output: null,
  additions: null,
  deletions: null,
});

/** A call that finished, and what it came back with. */
function made(
  name: string,
  target: string | null,
  output: string | null,
  changes: { additions: number; deletions: number } | null = null,
): ShownRun {
  return {
    name,
    target,
    status: 'complete',
    durationMs: 'timed',
    output,
    additions: changes?.additions ?? null,
    deletions: changes?.deletions ?? null,
  };
}

const madeImage = (name: string, target: string, image: ToolImage): ShownRun => ({
  ...made(name, target, null),
  images: [image],
});

/** A call that came back as a failure. */
const broke = (name: string, target: string, output: string | null): ShownRun => ({
  ...waiting(name, target),
  status: 'error',
  durationMs: 'timed',
  output,
});

/** The user asks something. */
const ask =
  (words: string) =>
  (thread: PiThread): void => {
    thread.sessionManager.appendMessage({ role: 'user', content: words, timestamp: 1 });
  };

/** Kira answers, with whatever she said and ran. */
const reply =
  (...content: AssistantPart[]) =>
  (thread: PiThread): void => {
    thread.sessionManager.appendMessage(assistantMessage(content, 2));
  };

/**
 * pi summarises the chat so far, writing an entry of its own between the
 * messages. That is what makes a compaction a boundary in the transcript rather
 * than something anybody said: it is an entry nobody wrote, sitting between two
 * that somebody did.
 */
const compacted =
  (summary: string, keep: number, details?: unknown): Step =>
  (thread: PiThread): void => {
    const messages = thread.sessionManager.getEntries().filter((entry) => entry.type === 'message');
    const firstKept = messages[keep];

    if (!firstKept) throw new Error(`there is no message ${keep} to keep`);

    // How much the context held is pi's to record and nothing in the window reads
    // it, so this number only has to be one.
    thread.sessionManager.appendCompaction(summary, firstKept.id, 20_000, details, true);
  };

/** Kira answers, and the provider said what the answer cost. */
const costing =
  (cost: { input: number; output: number; cacheRead?: number; cacheWrite?: number }): Step =>
  (thread: PiThread): void => {
    thread.sessionManager.appendMessage(
      assistantMessage([{ type: 'text', text: 'Done.' }], 2, cost),
    );
  };

/** Stand where the conversation begins, so the next reply is a second branch. */
function branchToStart(thread: PiThread): void {
  const first = thread.sessionManager.getEntries()[0];

  if (!first) {
    throw new Error('Nothing stored to branch from.');
  }

  thread.sessionManager.branch(first.id);
}

/** Something a case does to the stored conversation, in order. */
type Step = (thread: PiThread) => void;

/**
 * The tree as the window would receive it, with pi's generated ids — which are
 * random — replaced by the position of the message they name. What this keeps
 * is the shape: which message follows which.
 */
interface Shape {
  messages: Array<{ parent: number | null; role: string; parts: ShownPart[] }>;
  /** A boundary nothing follows, which is what compacting a chat leaves behind. */
  trailing: ShownPart[];
  head: number | null;
}

function shapeOf(transcript: ChatTranscript): Shape {
  assertTreeHangsTogether(transcript);

  const position = new Map(transcript.messages.map((message, index) => [message.id, index]));

  return {
    messages: transcript.messages.map((message) => ({
      parent: message.parentId === null ? null : (position.get(message.parentId) ?? null),
      role: message.role,
      parts: message.parts.map(shown),
    })),
    trailing: transcript.trailing.map(shown),
    head: transcript.headId === null ? null : (position.get(transcript.headId) ?? null),
  };
}

/** One part, with the two readings the window would have of it made stable. */
function shown(part: ChatPart): ShownPart {
  if (part.type === 'text') return part;
  if (part.type === 'compaction') return { ...part, at: 'recorded' };
  if (part.type === 'glossary') return part;

  return {
    ...part,
    durationMs: part.durationMs === null ? null : 'timed',
    calls: part.calls.map((call) => ({
      ...call,
      durationMs: call.durationMs === null ? null : 'timed',
    })),
  };
}

/**
 * Check the tree hangs together before anything is read out of it.
 *
 * Every message has to follow a message the transcript carries, because pi's
 * entry chain runs through entries that are not messages — model changes,
 * thinking levels, compaction — and a link to one of those is a link to nothing.
 * The window's runtime refuses the whole tree over a link like that, so it is
 * checked here: walking the tree would quietly read the message as the first one,
 * turning a broken transcript into a shorter one.
 */
function assertTreeHangsTogether(transcript: ChatTranscript): void {
  const carried = new Set(transcript.messages.map((message) => message.id));

  for (const message of transcript.messages) {
    assert.ok(
      message.parentId === null || carried.has(message.parentId),
      `${message.id} follows ${message.parentId}, which the transcript does not carry`,
    );
  }

  assert.ok(
    transcript.headId === null || carried.has(transcript.headId),
    `the transcript stands at ${transcript.headId}, which it does not carry`,
  );
}

/** One part as the transcript writes it. */
function lineOf(part: ChatPart): string {
  if (part.type === 'text') return part.text;
  if (part.type === 'compaction') return `[summarised ${part.messages} messages]`;
  if (part.type === 'glossary') return `[glossary ${part.change.term}]`;

  return part.calls.map((call) => `${call.name} ${call.target ?? ''}`.trim()).join(', ');
}

/**
 * What the reader sees: the path from where Kira stands back to the first
 * message, written as the lines it draws.
 *
 * Walked from the tree the same way the window walks it, so a head pointing at
 * the wrong branch shows up as the wrong lines rather than as a passing test. A
 * parent link that goes nowhere is caught before the walk — read here, it would
 * look like the start of the conversation.
 */
function visible(transcript: ChatTranscript): string[] {
  assertTreeHangsTogether(transcript);
  const byId = new Map(transcript.messages.map((message) => [message.id, message]));
  const path: ChatMessage[] = [];
  let message: ChatMessage | undefined = transcript.headId
    ? byId.get(transcript.headId)
    : undefined;

  while (message) {
    path.unshift(message);
    message = message.parentId === null ? undefined : byId.get(message.parentId);
  }

  return path.map((line) => `${line.role}: ${line.parts.map(lineOf).join(' ')}`);
}

/** Store `steps` in one thread, then answer what reopening it shows. */
async function transcriptOfStored(steps: Step[]): Promise<Shape> {
  const path = join(tempDir('kira-chat-store-'), 'threads.db');
  const store = new ThreadStore(path);
  const thread = createThread(store, tempDir('kira-chat-space-'));

  for (const step of steps) {
    step(thread);
  }

  store.close();

  const reopened = new ThreadStore(path);
  const conversation = await resumeConversation(reopened, thread.threadId, MODELS);
  const shape = shapeOf(conversation.transcript());
  conversation.close();
  reopened.close();

  return shape;
}

/** Store one thread per `case.threads` entry, then answer what the chat list shows. */
function listedChats(threads: Step[][]): Array<{ title: string; thread: number }> {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const created = threads.map((steps) => {
    const thread = createThread(store, tempDir('kira-chat-space-'));

    for (const step of steps) {
      step(thread);
    }

    return thread.threadId;
  });

  const chats: ChatSummary[] = listChats(store);
  store.close();

  return chats.map((chat) => ({ title: chat.title, thread: created.indexOf(chat.id) }));
}

const TRANSCRIPT_CASES = [
  {
    name: 'a user message with no reply yet is still in the transcript',
    steps: [ask('are you there?')],
    want: {
      trailing: [],
      messages: [{ parent: null, role: 'you', parts: [text('are you there?')] }],
      head: 0,
    },
  },
  {
    name: 'both sides of a finished turn are in the transcript, in order',
    steps: [ask('say hi'), reply({ type: 'text', text: 'hi' })],
    want: {
      trailing: [],
      messages: [
        { parent: null, role: 'you', parts: [text('say hi')] },
        { parent: 0, role: 'kira', parts: [text('hi')] },
      ],
      head: 1,
    },
  },
  {
    name: 'what Kira ran is part of her reply, naming what it acted on',
    steps: [
      reply(
        { type: 'text', text: 'Writing the notes down.' },
        ran('call-1', 'write', {
          // Content first, so a target built from raw argument order would
          // name the file body instead of the path.
          content: 'the whole file',
          path: 'notes.md',
        }),
      ),
    ],
    want: {
      trailing: [],
      messages: [
        {
          parent: null,
          role: 'kira',
          parts: [
            text('Writing the notes down.'),
            {
              type: 'work',
              reasoning: null,
              durationMs: null,
              calls: [waiting('write', 'notes.md')],
            },
          ],
        },
      ],
      head: 0,
    },
  },
  {
    name: 'a write shows the file contents, not its completion receipt',
    steps: [
      reply(ran('call-1', 'write', { path: 'fruits.md', content: 'apple\nbanana\ncherry' })),
      answered('call-1', 'write', { said: 'Successfully wrote to fruits.md' }),
    ],
    want: {
      trailing: [],
      messages: [
        {
          parent: null,
          role: 'kira',
          parts: [
            {
              type: 'work',
              reasoning: null,
              durationMs: 'timed',
              calls: [made('write', 'fruits.md', 'apple\nbanana\ncherry')],
            },
          ],
        },
      ],
      head: 0,
    },
  },
  {
    name: 'a tool that has answered says how it went, and what it changed',
    steps: [
      reply(ran('call-1', 'edit', { path: 'notes.md', edits: [] })),
      answered('call-1', 'edit', {
        // pi returns a receipt naming the edit it made; the change itself is in
        // the details beside it, and is what a reader opening the row wants.
        said: 'Successfully replaced 1 block(s) in notes.md.',
        diff: '  1 kept\n+ 2 added\n+ 3 also added\n- 4 gone',
      }),
    ],
    want: {
      trailing: [],
      messages: [
        {
          parent: null,
          role: 'kira',
          parts: [
            {
              type: 'work',
              reasoning: null,
              durationMs: 'timed',
              calls: [
                made('edit', 'notes.md', '  1 kept\n+ 2 added\n+ 3 also added\n- 4 gone', {
                  additions: 2,
                  deletions: 1,
                }),
              ],
            },
          ],
        },
      ],
      head: 0,
    },
  },
  {
    name: 'a glossary tool result becomes a quiet undo note rather than approval',
    steps: [
      reply(ran('call-1', 'tracker_update_glossary', { term: 'ticket' })),
      answered('call-1', 'tracker_update_glossary', {
        details: {
          workspaceId: 'workspace-1',
          chatId: 'chat-1',
          entryId: 'entry-1',
          version: 2,
          term: 'ticket',
        },
      }),
    ],
    want: {
      trailing: [],
      messages: [
        {
          parent: null,
          role: 'kira',
          parts: [
            {
              type: 'work',
              reasoning: null,
              durationMs: 'timed',
              calls: [made('tracker_update_glossary', 'ticket', 'done')],
            },
            {
              type: 'glossary',
              change: {
                workspaceId: 'workspace-1',
                chatId: 'chat-1',
                entryId: 'entry-1',
                version: 2,
                term: 'ticket',
              },
            },
          ],
        },
      ],
      head: 0,
    },
  },
  {
    name: 'what a tool came back with is kept with the run, so the row can be read',
    steps: [
      reply(ran('call-1', 'read', { path: 'notes.md' })),
      answered('call-1', 'read', { said: 'first line\nsecond line' }),
    ],
    want: {
      trailing: [],
      messages: [
        {
          parent: null,
          role: 'kira',
          parts: [
            {
              type: 'work',
              reasoning: null,
              durationMs: 'timed',
              calls: [made('read', 'notes.md', 'first line\nsecond line')],
            },
          ],
        },
      ],
      head: 0,
    },
  },
  {
    name: 'reading a skill is shown as loading that skill',
    steps: [
      reply(ran('call-1', 'read', { path: '/app/resources/skills/research/SKILL.md' })),
      answered('call-1', 'read', { said: 'Research guidance' }),
    ],
    want: {
      trailing: [],
      messages: [
        {
          parent: null,
          role: 'kira',
          parts: [
            {
              type: 'work',
              reasoning: null,
              durationMs: 'timed',
              calls: [made('load_skill', 'research', 'Research guidance')],
            },
          ],
        },
      ],
      head: 0,
    },
  },
  {
    name: 'a stored map proposal keeps its structured details in the transcript',
    steps: [
      reply(
        ran('call-map', 'propose_map', {
          title: 'Scale',
          body: 'Break it down',
          criteria: [],
          questions: [],
          research: [],
        }),
      ),
      answered('call-map', 'propose_map', {
        said: '{"id":"map-1"}',
        details: {
          kind: 'map-proposal',
          proposal: {
            id: 'map-1',
            title: 'Scale',
            body: 'Break it down',
            criteria: ['The destination is clear.'],
            questions: [{ title: 'Who?', body: 'Name users.', criteria: ['Users named.'] }],
            research: [],
          },
        },
      }),
    ],
    want: {
      trailing: [],
      messages: [
        {
          parent: null,
          role: 'kira',
          parts: [
            {
              type: 'work',
              reasoning: null,
              durationMs: 'timed',
              calls: [
                {
                  ...made('propose_map', null, '{"id":"map-1"}'),
                  map: {
                    id: 'map-1',
                    chatId: '',
                    title: 'Scale',
                    body: 'Break it down',
                    criteria: ['The destination is clear.'],
                    questions: [{ title: 'Who?', body: 'Name users.', criteria: ['Users named.'] }],
                    research: [],
                    status: 'proposed',
                    ticketId: null,
                  },
                },
              ],
            },
          ],
        },
      ],
      head: 0,
    },
  },
  {
    name: 'an image tool result remains an image in the transcript',
    steps: [
      reply(ran('call-1', 'screenshot', { path: 'screen.png' })),
      answered('call-1', 'screenshot', {
        image: { data: 'aGVsbG8=', mimeType: 'image/png' },
      }),
    ],
    want: {
      trailing: [],
      messages: [
        {
          parent: null,
          role: 'kira',
          parts: [
            {
              type: 'work',
              reasoning: null,
              durationMs: 'timed',
              calls: [
                madeImage('screenshot', 'screen.png', {
                  data: 'aGVsbG8=',
                  mimeType: 'image/png',
                }),
              ],
            },
          ],
        },
      ],
      head: 0,
    },
  },
  {
    name: 'a tool that came back with nothing has nothing to read',
    steps: [
      reply(ran('call-1', 'bash', { command: 'true' })),
      answered('call-1', 'bash', { said: '  \n\n' }),
    ],
    want: {
      trailing: [],
      messages: [
        {
          parent: null,
          role: 'kira',
          parts: [
            {
              type: 'work',
              reasoning: null,
              durationMs: 'timed',
              calls: [made('bash', 'true', null)],
            },
          ],
        },
      ],
      head: 0,
    },
  },
  {
    name: 'a tool that came back as a failure reads as one',
    steps: [
      reply(ran('call-1', 'read', { path: 'missing.md' })),
      answered('call-1', 'read', {
        isError: true,
        said: 'ENOENT: no such file or directory, open missing.md',
      }),
    ],
    want: {
      trailing: [],
      messages: [
        {
          parent: null,
          role: 'kira',
          parts: [
            {
              type: 'work',
              reasoning: null,
              durationMs: 'timed',
              calls: [
                broke('read', 'missing.md', 'ENOENT: no such file or directory, open missing.md'),
              ],
            },
          ],
        },
      ],
      head: 0,
    },
  },
  {
    name: 'tools she ran one after another are one run, and words between them start another',
    steps: [
      reply(
        ran('call-a', 'read', { path: 'one.md' }),
        ran('call-b', 'bash', { command: 'ls -la' }),
        { type: 'text', text: 'Now writing.' },
        ran('call-c', 'edit', { path: 'two.md', edits: [] }),
      ),
      answered('call-a', 'read'),
      answered('call-b', 'bash'),
    ],
    want: {
      trailing: [],
      messages: [
        {
          parent: null,
          role: 'kira',
          parts: [
            {
              type: 'work',
              reasoning: null,
              durationMs: 'timed',
              calls: [made('read', 'one.md', 'done'), made('bash', 'ls -la', 'done')],
            },
            text('Now writing.'),
            { type: 'work', reasoning: null, durationMs: null, calls: [waiting('edit', 'two.md')] },
          ],
        },
      ],
      head: 0,
    },
  },
  {
    name: 'asking again keeps both replies, as two branches of the question',
    steps: [
      ask('say hi'),
      reply({ type: 'text', text: 'hi' }),
      branchToStart,
      reply({ type: 'text', text: 'hello' }),
    ],
    want: {
      trailing: [],
      messages: [
        { parent: null, role: 'you', parts: [text('say hi')] },
        { parent: 0, role: 'kira', parts: [text('hi')] },
        { parent: 0, role: 'kira', parts: [text('hello')] },
      ],
      head: 2,
    },
  },
  {
    name: 'entries that are not messages the user wrote or read are not messages',
    steps: [
      (thread: PiThread) => thread.sessionManager.appendModelChange('openai-codex', 'gpt-5.6-luna'),
      reply({ type: 'text', text: '' }),
    ],
    want: { messages: [], trailing: [], head: null },
  },
  {
    name: 'a compaction stands on the message it hands over to, leading with what was asked',
    // The boundary belongs to what comes *after* it: the reading order is "here
    // is where the chat was summarised, and this is what carries on from it".
    steps: [
      ask('the first question'),
      reply({ type: 'text', text: 'the first answer' }),
      ask('the second question'),
      reply({ type: 'text', text: 'the second answer' }),
      compacted('## Transcript\n\n**person:** the first question', 2, {
        lastWords: 'the first question',
      }),
      // Compaction is the one entry that stops being invisible. Everything else
      // that is not a message is still dropped, boundary or no boundary.
      (thread: PiThread) => thread.sessionManager.appendModelChange('openai-codex', 'gpt-5.6-luna'),
      ask('the third question'),
      reply({ type: 'text', text: 'the third answer' }),
    ],
    want: {
      trailing: [],
      messages: [
        { parent: null, role: 'you', parts: [text('the first question')] },
        { parent: 0, role: 'kira', parts: [text('the first answer')] },
        { parent: 1, role: 'you', parts: [text('the second question')] },
        { parent: 2, role: 'kira', parts: [text('the second answer')] },
        {
          parent: 3,
          role: 'you',
          parts: [
            {
              type: 'compaction',
              at: 'recorded',
              lastWords: 'the first question',
              // The question and its answer, which pi kept the second of: what
              // the model no longer reads as it was written.
              messages: 2,
              reconstruction: '## Transcript\n\n**person:** the first question',
            },
            text('the third question'),
          ],
        },
        { parent: 4, role: 'kira', parts: [text('the third answer')] },
      ],
      head: 5,
    },
  },
  {
    name: 'a compaction pi wrote itself has no words to lead with, and still shows',
    // What Kira's extension answers carries the words; a compaction from
    // before this feature, or pi's own fallback when the extension cannot answer,
    // carries none. The boundary still says how much it took.
    steps: [
      ask('the first question'),
      reply({ type: 'text', text: 'the first answer' }),
      ask('the second question'),
      reply({ type: 'text', text: 'the second answer' }),
      compacted('## Transcript\n\n**person:** the first question', 2),
      ask('the third question'),
      reply({ type: 'text', text: 'the third answer' }),
    ],
    want: {
      trailing: [],
      messages: [
        { parent: null, role: 'you', parts: [text('the first question')] },
        { parent: 0, role: 'kira', parts: [text('the first answer')] },
        { parent: 1, role: 'you', parts: [text('the second question')] },
        { parent: 2, role: 'kira', parts: [text('the second answer')] },
        {
          parent: 3,
          role: 'you',
          parts: [
            {
              type: 'compaction',
              at: 'recorded',
              lastWords: null,
              messages: 2,
              reconstruction: '## Transcript\n\n**person:** the first question',
            },
            text('the third question'),
          ],
        },
        { parent: 4, role: 'kira', parts: [text('the third answer')] },
      ],
      head: 5,
    },
  },
  {
    name: 'a chat compacted with nothing said after it still shows the boundary',
    // What compacting a chat by hand leaves behind: the summary is the last
    // thing that happened, and a boundary nothing hangs on would otherwise be
    // dropped — so a chat compacted a moment ago would read as one that had not
    // been, which is what makes the action look like it did nothing.
    steps: [
      ask('the first question'),
      reply({ type: 'text', text: 'the first answer' }),
      ask('the second question'),
      reply({ type: 'text', text: 'the second answer' }),
      compacted('## Transcript\n\n**person:** the first question', 2, {
        lastWords: 'the first question',
      }),
    ],
    want: {
      messages: [
        { parent: null, role: 'you', parts: [text('the first question')] },
        { parent: 0, role: 'kira', parts: [text('the first answer')] },
        { parent: 1, role: 'you', parts: [text('the second question')] },
        { parent: 2, role: 'kira', parts: [text('the second answer')] },
      ],
      trailing: [
        {
          type: 'compaction',
          at: 'recorded',
          lastWords: 'the first question',
          messages: 2,
          reconstruction: '## Transcript\n\n**person:** the first question',
        },
      ],
      head: 3,
    },
  },
  {
    name: 'what she thought before answering is a step of its own, read apart from the answer',
    steps: [
      reply(thought('Let me think about that.'), { type: 'text', text: 'Sure, here you go.' }),
    ],
    want: {
      trailing: [],
      messages: [
        {
          parent: null,
          role: 'kira',
          parts: [
            { type: 'work', reasoning: 'Let me think about that.', durationMs: null, calls: [] },
            text('Sure, here you go.'),
          ],
        },
      ],
      head: 0,
    },
  },
  {
    name: 'what she thought before running a tool joins that run as one step',
    steps: [
      reply(thought('I should check the file first.'), ran('call-1', 'read', { path: 'notes.md' })),
      answered('call-1', 'read'),
    ],
    want: {
      trailing: [],
      messages: [
        {
          parent: null,
          role: 'kira',
          parts: [
            {
              type: 'work',
              reasoning: 'I should check the file first.',
              durationMs: 'timed',
              calls: [made('read', 'notes.md', 'done')],
            },
          ],
        },
      ],
      head: 0,
    },
  },
];

const LIST_CASES = [
  {
    name: 'chats are listed with the one used most recently first',
    threads: [[ask('first')], [ask('second')]],
    want: [
      { title: 'second', thread: 1 },
      { title: 'first', thread: 0 },
    ],
  },
  {
    name: 'a chat is labelled with what the user first asked it',
    threads: [[ask('the first question'), ask('a later question')]],
    want: [{ title: 'the first question', thread: 0 }],
  },
  {
    name: 'a message written in paragraphs names the chat by its first line',
    threads: [[ask('KIRA-3 — a ticket\n\nRun this ticket. Work in a checkout.')]],
    want: [{ title: 'KIRA-3 — a ticket', thread: 0 }],
  },
  {
    name: 'a chat that went back to the beginning is called by what it asks now',
    threads: [[ask('the first question'), sayItAgain, ask('a different question')]],
    want: [{ title: 'a different question', thread: 0 }],
  },
  {
    name: 'a chat nothing has been asked in yet is called New chat',
    threads: [
      [
        (thread: PiThread) =>
          thread.sessionManager.appendModelChange('openai-codex', 'gpt-5.6-luna'),
      ],
    ],
    want: [{ title: 'New chat', thread: 0 }],
  },
  {
    name: 'a label is one line, whichever line it was taken from',
    threads: [[ask('one\n  two')]],
    want: [{ title: 'one', thread: 0 }],
  },
  {
    name: 'a label is cut when the line it is taken from is long',
    threads: [[ask(`${'x'.repeat(60)}`)]],
    want: [{ title: `${'x'.repeat(48)}\u2026`, thread: 0 }],
  },
];

for (const testCase of TRANSCRIPT_CASES) {
  test(testCase.name, async () => {
    assert.deepEqual(await transcriptOfStored(testCase.steps), testCase.want);
  });
}

for (const testCase of LIST_CASES) {
  test(testCase.name, () => {
    assert.deepEqual(listedChats(testCase.threads), testCase.want);
  });
}

/** Say the same thing again, the way a repeat starts a second question. */
function sayItAgain(thread: PiThread): void {
  thread.sessionManager.resetLeaf();
}

/** What a reader does to the reopened conversation before it is read again. */
type Show = (conversation: Conversation, messages: string[]) => Promise<void>;

interface BranchCase {
  name: string;
  store: Step[];
  show?: Show;
  want: string[];
}

/**
 * Two answers to one question, written as alternatives: the shape a repeat
 * leaves behind, where the second question stands beside the first.
 */
const SAID_AGAIN: Step[] = [
  ask('say hi'),
  reply({ type: 'text', text: 'hi' }),
  sayItAgain,
  ask('say hi'),
  reply({ type: 'text', text: 'hello' }),
];

/** Two answers to one question, hung off the question itself. */
const TWO_ANSWERS: Step[] = [
  ask('say hi'),
  reply({ type: 'text', text: 'hi' }),
  branchToStart,
  reply({ type: 'text', text: 'hello' }),
];

const BRANCH_CASES: BranchCase[] = [
  {
    name: 'a conversation reopened shows the branch written last',
    store: SAID_AGAIN,
    want: ['you: say hi', 'kira: hello'],
  },
  {
    name: 'showing a branch shows that whole exchange, question and all',
    store: SAID_AGAIN,
    show: (conversation, messages) => conversation.switchBranch(messages[0]!),
    want: ['you: say hi', 'kira: hi'],
  },
  {
    name: 'a branch left behind is still there, and can be shown again',
    store: SAID_AGAIN,
    show: async (conversation, messages) => {
      await conversation.switchBranch(messages[0]!);
      await conversation.switchBranch(messages[3]!);
    },
    want: ['you: say hi', 'kira: hello'],
  },
  {
    name: 'two replies to one question are alternatives of that question',
    store: TWO_ANSWERS,
    show: (conversation, messages) => conversation.switchBranch(messages[1]!),
    want: ['you: say hi', 'kira: hi'],
  },
];

/** The ids of a stored thread's messages, in the order they were written. */
function messageIds(thread: PiThread): string[] {
  return thread.sessionManager
    .getEntries()
    .filter((entry) => entry.type === 'message')
    .map((entry) => entry.id);
}

/**
 * Store one conversation per case, show what the case shows, then reopen it the
 * way a relaunch does and answer what it shows *then*. A branch switch writes no
 * entry, so where the window was reading is only kept if we keep it ourselves.
 */
async function afterShowing(testCase: BranchCase): Promise<string[]> {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-chat-space-'));

  for (const step of testCase.store) {
    step(thread);
  }

  const conversation = await resumeConversation(store, thread.threadId, MODELS);
  const messages = messageIds(thread);

  await testCase.show?.(conversation, messages);
  conversation.close();

  const reopened = await resumeConversation(store, thread.threadId, MODELS);
  const shown = visible(reopened.transcript());
  reopened.close();
  store.close();

  return shown;
}

for (const testCase of BRANCH_CASES) {
  test(testCase.name, async () => {
    assert.deepEqual(await afterShowing(testCase), testCase.want);
  });
}

/** A conversation with a follow-up in it, so a case has somewhere to go back to. */
const FOLLOW_UP: Step[] = [
  ask('where are we'),
  reply({ type: 'text', text: 'in the folder' }),
  ask('and the tests'),
  reply({ type: 'text', text: 'all green' }),
];

interface EditCase {
  name: string;
  store: Step[];
  /** Which message, by position, is taken back before the conversation is read. */
  undo: number;
  want: string[];
}

/**
 * Changing a message replaces it where it stood: the replacement becomes a
 * sibling of the words it replaces, and the reader carries on from it. What is
 * answered to it is the next turn's business, so only where it leaves the
 * conversation is asked about here.
 */
const EDIT_CASES: EditCase[] = [
  {
    name: 'taking back a question leaves the reader where that question was said',
    store: FOLLOW_UP,
    undo: 2,
    want: ['you: where are we', 'kira: in the folder'],
  },
  {
    name: 'taking back the first question stands where the conversation begins',
    store: FOLLOW_UP,
    undo: 0,
    want: [],
  },
];

/**
 * Take a message back, and answer what the conversation shows while it is open.
 *
 * Undoing writes no entry — pi keeps the position, and the message that follows
 * is what records it — so the live conversation is the only place that position
 * exists to be read.
 */
async function afterTakingBack(testCase: EditCase): Promise<string[]> {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-chat-space-'));

  for (const step of testCase.store) {
    step(thread);
  }

  const conversation = await resumeConversation(store, thread.threadId, MODELS);
  await conversation.editMessage(messageIds(thread)[testCase.undo]!);

  const shown = visible(conversation.transcript());
  conversation.close();
  store.close();

  return shown;
}

for (const testCase of EDIT_CASES) {
  test(testCase.name, async () => {
    assert.deepEqual(await afterTakingBack(testCase), testCase.want);
  });
}

test('switching to what is not a message is refused, and moves nothing', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-chat-space-'));

  for (const step of FOLLOW_UP) {
    step(thread);
  }

  const conversation = await resumeConversation(store, thread.threadId, MODELS);
  const before = visible(conversation.transcript());

  // A thread's own id is its header's: an entry the chat stored, but not a
  // message in it.
  for (const [what, messageId] of [
    ['an id this chat never stored', 'made-up'],
    ['the chat itself', thread.threadId],
  ] as const) {
    await assert.rejects(
      conversation.switchBranch(messageId),
      new Error(`This chat has no message ${messageId}.`),
      what,
    );
  }

  // Refusing is not moving: the reader is still on the branch it was on.
  assert.deepEqual(visible(conversation.transcript()), before);
  conversation.close();
  store.close();
});

test('taking a question back keeps the words it replaced, as a branch to go back to', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-chat-space-'));

  for (const step of FOLLOW_UP) {
    step(thread);
  }

  const conversation = await resumeConversation(store, thread.threadId, MODELS);
  const [first, , followed] = messageIds(thread);
  await conversation.editMessage(followed!);

  // The question and the answer it got are still in the tree: changing one
  // writes another beside it rather than striking it out.
  assert.equal(conversation.transcript().messages.length, 4);

  // And the branch can be shown again, whole.
  await conversation.switchBranch(followed!);
  assert.deepEqual(visible(conversation.transcript()), [
    'you: where are we',
    'kira: in the folder',
    'you: and the tests',
    'kira: all green',
  ]);

  // What was said first is still the root of all of it.
  await conversation.switchBranch(first!);
  assert.deepEqual(visible(conversation.transcript()), [
    'you: where are we',
    'kira: in the folder',
  ]);
  conversation.close();
  store.close();
});

test('a reply is not yours to take back, and neither is a message that was never there', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-chat-space-'));

  for (const step of SAID_AGAIN) {
    step(thread);
  }

  const conversation = await resumeConversation(store, thread.threadId, MODELS);
  const before = visible(conversation.transcript());

  for (const [what, messageId] of [
    ['a reply', messageIds(thread)[1]!],
    ['an id this chat never stored', 'made-up'],
  ] as const) {
    await assert.rejects(
      conversation.editMessage(messageId),
      new Error('Only your own message can be changed.'),
      what,
    );
  }

  // Refusing is not moving: the conversation is still where it was.
  assert.deepEqual(visible(conversation.transcript()), before);
  conversation.close();
  store.close();
});

interface ForkCase {
  name: string;
  store: Step[];
  /** Which stored message the fork is made from, by its position. */
  forkAt: number;
  want: { forked: string[]; source: string[] };
}

/** A conversation with a follow-up in it, so a fork has a path to carry. */
const FORK_CASES: ForkCase[] = [
  {
    name: 'a new chat holds the conversation up to the message it was forked from',
    store: FOLLOW_UP,
    forkAt: 1,
    want: {
      forked: ['you: where are we', 'kira: in the folder'],
      source: ['you: where are we', 'kira: in the folder', 'you: and the tests', 'kira: all green'],
    },
  },
  {
    name: 'a fork takes the branch it was made from and leaves the other one behind',
    store: TWO_ANSWERS,
    forkAt: 1,
    want: {
      forked: ['you: say hi', 'kira: hi'],
      source: ['you: say hi', 'kira: hello'],
    },
  },
  {
    name: 'a fork made from a question holds the question and no answer to it',
    store: [ask('say hi'), reply({ type: 'text', text: 'hi' })],
    forkAt: 0,
    want: {
      forked: ['you: say hi'],
      source: ['you: say hi', 'kira: hi'],
    },
  },
];

/** Fork one conversation per case, and answer what each chat shows afterwards. */
async function afterForking(testCase: ForkCase): Promise<ForkCase['want']> {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-chat-space-'));

  for (const step of testCase.store) {
    step(thread);
  }

  const messages = thread.sessionManager
    .getEntries()
    .filter((entry) => entry.type === 'message')
    .map((entry) => entry.id);

  const forked = await forkConversation(store, thread.threadId, messages[testCase.forkAt]!, MODELS);
  const forkedShown = visible(forked.transcript());
  forked.close();

  // Read the chat it came from afterwards: a fork that quietly took the
  // conversation with it would show up here, not in the fork.
  const source = await resumeConversation(store, thread.threadId, MODELS);
  const sourceShown = visible(source.transcript());
  source.close();
  store.close();

  return { forked: forkedShown, source: sourceShown };
}

for (const testCase of FORK_CASES) {
  test(testCase.name, async () => {
    assert.deepEqual(await afterForking(testCase), testCase.want);
  });
}

test('a fork remembers the chat it came from, and works where that one did', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-chat-space-'));
  ask('say hi')(thread);
  const asked = thread.sessionManager.getEntries().at(-1);
  assert.ok(asked, 'the question is stored');

  const forked = await forkConversation(store, thread.threadId, asked.id, MODELS);
  const forkedId = forked.threadId;
  forked.close();

  assert.notEqual(forkedId, thread.threadId);
  assert.equal(store.getThread(forkedId).parentThreadId, thread.threadId);
  assert.equal(store.getThread(forkedId).cwd, thread.cwd);

  // pi says the same thing in its own header, which is what a session file
  // would hold if pi had written one.
  const header = openThread(store, forkedId).sessionManager.getHeader();
  assert.equal(header?.parentSession, thread.threadId);
  store.close();
});

test('forking from what is not a message fails, and stores nothing', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-chat-space-'));
  ask('say hi')(thread);

  // A thread's own id is its header's: an entry pi stored, but not a message.
  for (const [what, id] of [
    ['an id this chat never stored', 'made-up'],
    ['the chat itself', thread.threadId],
  ] as const) {
    await assert.rejects(
      forkConversation(store, thread.threadId, id, MODELS),
      new Error(`This chat has no message ${id}.`),
      what,
    );
  }

  // Only what was there before: a fork that failed has not left a half-made
  // chat behind, which the list would then offer to open.
  assert.deepEqual(
    store.listThreads().map((stored) => stored.id),
    [thread.threadId],
  );
  store.close();
});

test('a chat continued after reopening links the new message to a message', async () => {
  // Where pi hangs a new message is the entry it was standing at, and after a
  // reopen that is the last thing stored — a model change or a thinking level,
  // not a message. A link to one of those is a link to nothing, and the window's
  // runtime refuses the whole tree rather than draw it, so the transcript has to
  // shorten the link to the message above.
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const started = await startConversation(store, tempDir('kira-chat-space-'), MODELS);
  started.close();

  ask('say hi')(openThread(store, started.threadId));

  const transcript = (await resumeConversation(store, started.threadId, MODELS)).transcript();

  assert.deepEqual(shapeOf(transcript), {
    messages: [{ parent: null, role: 'you', parts: [text('say hi')] }],
    trailing: [],
    head: 0,
  });

  store.close();
});

test('reopening the chat used most recently continues it instead of starting one', async () => {
  const path = join(tempDir('kira-chat-store-'), 'threads.db');
  const cwd = tempDir('kira-chat-space-');
  const store = new ThreadStore(path);

  const first = await startConversation(store, cwd, MODELS);
  first.close();

  // What the app does on launch: resume the chat the list puts first.
  const latest = store.listThreads()[0];
  assert.ok(latest, 'the chat just started is stored');
  const reopened = await resumeConversation(store, latest.id, MODELS);

  assert.equal(reopened.threadId, first.threadId, 'the same thread is continued');
  reopened.close();
  store.close();

  // The thread id staying put is only half of it: a new conversation would have
  // been stored as a second row, which the reopened window would then prefer.
  const db = new DatabaseSync(path, { readOnly: true });
  const row = db.prepare('SELECT COUNT(*) AS count FROM threads').get() as { count: number };
  db.close();

  assert.equal(row.count, 1);
});

test('opening a named chat continues that one, not the newest', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));

  const older = createThread(store, tempDir('kira-chat-space-'));
  ask('the older chat')(older);
  const newer = createThread(store, tempDir('kira-chat-space-'));
  ask('the newer chat')(newer);

  // The newer chat is the one a launch resumes; the list asked for the older.
  const resumed = await resumeConversation(store, older.threadId, MODELS);

  assert.equal(resumed.threadId, older.threadId);
  assert.deepEqual(shapeOf(resumed.transcript()), {
    messages: [{ parent: null, role: 'you', parts: [text('the older chat')] }],
    trailing: [],
    head: 0,
  });

  resumed.close();
  store.close();
});

test('a new chat is a new thread, and does not touch the one before it', async () => {
  const path = join(tempDir('kira-chat-store-'), 'threads.db');
  const store = new ThreadStore(path);

  const first = await startConversation(store, tempDir('kira-chat-space-'), MODELS);
  const second = await startConversation(store, tempDir('kira-chat-space-'), MODELS);

  assert.notEqual(second.threadId, first.threadId);
  assert.deepEqual(
    second.transcript(),
    { messages: [], trailing: [], headId: null },
    'a new chat starts empty',
  );

  second.close();
  first.close();
  store.close();

  const db = new DatabaseSync(path, { readOnly: true });
  const row = db.prepare('SELECT COUNT(*) AS count FROM threads').get() as { count: number };
  db.close();

  assert.equal(row.count, 2);
});

test('compacting a chat by hand summarises it now, and shows the boundary', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-chat-space-'));

  // Long enough that pi will cut it: compaction triggers on tokens, and pi
  // refuses a chat holding too little to be worth summarising. The case below is
  // the other side of that refusal.
  ask('the first question')(thread);
  reply({ type: 'text', text: 'the first answer' })(thread);
  ask(`the second question ${'x'.repeat(600_000)}`)(thread);
  reply({ type: 'text', text: 'the second answer' })(thread);

  const conversation = await resumeConversation(store, thread.threadId, MODELS);
  const heard: ChatEvent[] = [];
  const stopListening = conversation.subscribe((event) => heard.push(event));

  await conversation.compact();
  stopListening();

  const shape = shapeOf(conversation.transcript());

  conversation.close();
  store.close();

  // The window is told by event, and it has to be: a compaction runs no agent, so
  // pi's own settling event — the one that carries the transcript after a turn —
  // never arrives. Without this the boundary exists and nobody draws it until
  // something else happens.
  const told = heard.findLast((event) => event.type === 'transcript');
  assert.ok(told?.type === 'transcript', 'compacting told the window nothing');
  assert.equal(told.transcript.trailing.length, 1, 'and what it said held the boundary');

  // One boundary, hanging on nothing: the chat was compacted and nothing has
  // been said since, which is exactly what pressing the button leaves behind.
  assert.equal(shape.trailing.length, 1);
  const [boundary] = shape.trailing;
  assert.ok(boundary?.type === 'compaction');

  // The words are Kira's own reconstruction rather than a model's summary,
  // and that is the point: this went through the same hook a threshold
  // compaction does, so there is one kind of summary and not two.
  assert.match(boundary.reconstruction, /^## Goal$/m);
  assert.match(boundary.reconstruction, /the first question/);
  // pi cut the first turn and kept the second, which is pi's own choice about
  // how much to keep: what the boundary leads with and counts follows from it.
  assert.equal(boundary.lastWords, 'the first question');
  assert.equal(boundary.messages, 2);

  // Nothing said is taken away: compacting changes what the model reads, not
  // what the chat holds.
  assert.equal(shape.messages.length, 4);
});

test('compacting a chat holding almost nothing changes nothing, and says so', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-chat-space-'));

  ask('the only question')(thread);
  reply({ type: 'text', text: 'the only answer' })(thread);

  const conversation = await resumeConversation(store, thread.threadId, MODELS);

  // Refused rather than done, because there is nothing here to summarise — and
  // refused in Kira's words, since pi's own ("Nothing to compact (session too
  // small)") is not a sentence that belongs in front of a person.
  await assert.rejects(() => conversation.compact(), {
    message: 'There is nothing in this chat to compact yet.',
  });

  const shape = shapeOf(conversation.transcript());

  conversation.close();
  store.close();

  assert.deepEqual(shape.trailing, [], 'nothing was summarised, so nothing stands at the end');
  assert.equal(shape.messages.length, 2, 'and nothing was taken away');
});

test('a chat started where it was told keeps the id it was composed under', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const workspace = store.rememberWorkspace(tempDir('kira-chat-workspace-'));

  const started = await startConversation(store, workspace.folder, MODELS, {
    id: 'composed-already',
    workspaceId: workspace.id,
  });

  // The id is the one a window composed the new chat under, and the folder and
  // workspace are the ones it was begun for: nothing about the chat is decided at
  // the moment it is stored, only written down.
  assert.equal(started.threadId, 'composed-already');
  assert.equal(store.getThread(started.threadId).cwd, workspace.folder);
  assert.equal(store.getThread(started.threadId).workspaceId, workspace.id);

  started.close();
  store.close();
});

test('stopping a chat that is not writing leaves it exactly as it was', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-chat-space-'));
  ask('where are we')(thread);
  reply({ type: 'text', text: 'in the folder' })(thread);

  const conversation = await resumeConversation(store, thread.threadId, MODELS);
  const before = shapeOf(conversation.transcript());

  // There is no turn to stop here, and pi's abort settles a session that is
  // already idle rather than refusing — stopping must never itself be the thing
  // that changes a conversation. Nothing was waiting either, so nothing comes
  // back to be said differently.
  assert.deepEqual(await conversation.stop(), []);

  assert.deepEqual(shapeOf(conversation.transcript()), before);
  assert.equal(conversation.isRunning(), false);
  assert.equal(conversation.streaming(), null);
  assert.deepEqual(conversation.queued(), []);

  conversation.close();
  store.close();
});

/**
 * A server that refuses every completion, the way the pool does when it cannot
 * serve a model.
 *
 * A refusal rather than a dead socket: pi ends a turn it could not complete with
 * an error on the message instead of rejecting, and that is the case worth
 * pinning — a transport failure throws on its own and would pass this test
 * whether or not anything read the error.
 */
async function refusingProvider(): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(400, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        error: {
          message: 'unknown provider for model nope-9',
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port to refuse on');

  return {
    url: `http://127.0.0.1:${address.port}`,
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

test('a turn whose provider refuses is a failure, not an empty reply', async () => {
  const provider = await refusingProvider();
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));

  try {
    const conversation = await startConversation(
      store,
      tempDir('kira-chat-space-'),
      rememberedModels(provider.url),
    );

    // What the pool said is what the caller hears. Without this the turn ends on
    // an empty message, and Kira reads as having had nothing to say.
    await assert.rejects(
      () => conversation.send('hello'),
      (error: Error) => error.message.includes('unknown provider for model nope-9'),
    );

    conversation.close();
  } finally {
    await provider.stop();
    store.close();
  }
});

test('a chat whose memory cannot be written still opens, and still says what it holds', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-chat-space-'));
  ask('Fix the auth bug in the login flow')(thread);

  // What a database that will not take the write looks like from here.
  store.recordObservations = () => {
    throw new Error('the disk is full');
  };

  // Holding a chat's memory is bookkeeping, and the chat is not the bookkeeping's
  // to take down with it. Opening happens through the observer, so a throw there
  // would be a chat that cannot be read at all — for a ledger that is recomputed
  // whole on the next pass anyway.
  const conversation = await resumeConversation(store, thread.threadId, MODELS);

  assert.deepEqual(conversation.memory(), []);
  assert.equal(conversation.transcript().messages.length, 1);
  conversation.close();
});

test('a turn goes on being work Kira was told about, even when it is not answered', async () => {
  const provider = await refusingProvider();
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));

  try {
    const conversation = await startConversation(
      store,
      tempDir('kira-chat-space-'),
      rememberedModels(provider.url),
    );

    // The turn fails at the provider and settles anyway, which is when the
    // observer runs. What the person was told is Kira's from then on whether or
    // not an answer arrived — the point of watching the chat rather than the
    // reply. And it costs nothing: the only request this server saw was the one
    // the turn itself made, and that one is why this case needs a stub at all.
    await assert.rejects(() => conversation.send('Fix the auth bug in the login flow'));

    assert.deepEqual(
      conversation.memory().map(({ kind, text }) => ({ kind, text })),
      [{ kind: 'goal', text: 'Fix the auth bug in the login flow' }],
    );
    conversation.close();
  } finally {
    await provider.stop();
    store.close();
  }
});

/**
 * Models over a cache holding `ids`, in the order given: the order is the
 * server's, and the first is what the pool prefers.
 */
function modelsOffering(ids: string[]): Models {
  const cache = join(tempDir('kira-chat-models-'), 'models.json');
  writeFileSync(cache, JSON.stringify({ models: ids.map((id) => ({ id })) }));

  return kiraModels({
    server: 'http://localhost:4100',
    cachePath: cache,
    token: async () => 'device-key',
    catalog: async () => ({ kind: 'unavailable' }),
  });
}

test('a chat runs on the model it was running on when it was reopened', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const models = modelsOffering(['first-model', 'second-model']);

  const started = await startConversation(store, tempDir('kira-chat-space-'), models);

  // A chat that has chosen nothing runs on what the pool prefers, which is the
  // first of what it offers rather than a model this side picked.
  assert.equal(started.modelId(), 'first-model');

  await started.choose('second-model');
  assert.equal(started.modelId(), 'second-model');
  started.close();

  const reopened = await resumeConversation(store, started.threadId, models);

  // The choice is the chat's, so it outlives the session that was open when it
  // was made — which is the whole point of writing it down.
  assert.equal(reopened.modelId(), 'second-model');
  reopened.close();
  store.close();
});

test('a chat remembering a model the pool has dropped runs on what it prefers', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const both = modelsOffering(['first-model', 'second-model']);

  const started = await startConversation(store, tempDir('kira-chat-space-'), both);
  await started.choose('second-model');
  started.close();

  // The pool stops serving it. A session built on a model the server no longer
  // offers is a request that fails, so the chat falls back rather than
  // remembering its way into one.
  const onlyFirst = modelsOffering(['first-model']);
  const reopened = await resumeConversation(store, started.threadId, onlyFirst);

  assert.equal(reopened.modelId(), 'first-model');
  reopened.close();
  store.close();
});

test('a chat remembering another provider’s model runs on Kira’s', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const models = modelsOffering(['first-model']);

  const started = await startConversation(store, tempDir('kira-chat-space-'), models);
  started.close();

  // What an install that ran on pi's own provider would have written down. The
  // model is asked for by id like any other, so a chat stored by an older
  // install cannot bring pi's provider — and the credential pi resolves for it —
  // back into use (docs/adr/0003-model-credentials.md).
  store.setThreadModel(started.threadId, 'gpt-5.6-luna');

  const reopened = await resumeConversation(store, started.threadId, models);

  assert.equal(reopened.modelId(), 'first-model');
  reopened.close();
  store.close();
});

test('a model the pool does not offer cannot be chosen', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const models = modelsOffering(['first-model']);
  const conversation = await startConversation(store, tempDir('kira-chat-space-'), models);

  await assert.rejects(
    () => conversation.choose('nope-9'),
    (error: Error) => error.message.includes('nope-9'),
  );
  assert.equal(conversation.modelId(), 'first-model');
  conversation.close();
  store.close();
});

test('a fork runs on the model its source ran on, and keeps it', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const models = modelsOffering(['first-model', 'second-model']);
  const thread = createThread(store, tempDir('kira-chat-space-'));
  ask('say hi')(thread);
  const asked = thread.sessionManager.getEntries().at(-1);
  assert.ok(asked, 'the question is stored');

  // A chat that had been changed to the pool's second model.
  store.setThreadModel(thread.threadId, 'second-model');

  const forked = await forkConversation(store, thread.threadId, asked.id, models);
  assert.equal(forked.modelId(), 'second-model');
  const forkedId = forked.threadId;
  forked.close();

  // Still that one after being reopened. A fork is the same conversation up to a
  // point, so it runs on what that conversation ran on rather than reverting to
  // what the pool prefers the moment it is read again.
  const reopened = await resumeConversation(store, forkedId, models);
  assert.equal(reopened.modelId(), 'second-model');
  reopened.close();
  store.close();
});

test('a chat whose model the pool drops runs on the pool\u2019s, and remembers that', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const started = await startConversation(
    store,
    tempDir('kira-chat-space-'),
    modelsOffering(['first-model', 'second-model']),
    { modelId: 'second-model' },
  );
  const chatId = started.threadId;
  assert.equal(started.modelId(), 'second-model');
  started.close();

  // The pool stops serving what this chat remembers.
  const reopened = await resumeConversation(store, chatId, modelsOffering(['first-model']));
  assert.equal(reopened.modelId(), 'first-model');
  reopened.close();

  // The row says what the chat is running on rather than what it once asked for:
  // a reopening asks the pool again either way, and a row still naming the
  // dropped model would be describing a chat that no longer exists.
  assert.equal(store.getThread(chatId).modelId, 'first-model');
  store.close();
});

/**
 * What the composer's tooltip says about the chat itself, as a case sets it up.
 *
 * The spend is the sum a person can check by hand — input plus output, which is
 * how the allowance counts tokens (docs/adr/0005-allowances.md) — so these are
 * worked examples rather than the rule written out again in numbers.
 */
const SPEND_CASES: Array<{ name: string; store: Step[]; spent: number }> = [
  {
    name: 'a chat nobody has said anything in has spent nothing',
    store: [],
    spent: 0,
  },
  {
    name: 'every reply in the chat is added up',
    store: [
      ask('one'),
      costing({ input: 100, output: 20 }),
      ask('two'),
      costing({ input: 5, output: 7 }),
    ],
    spent: 132,
  },
  {
    name: 'what the provider cached is not part of what the chat spent',
    store: [ask('one'), costing({ input: 10, output: 2, cacheRead: 5_000, cacheWrite: 400 })],
    spent: 12,
  },
];

for (const testCase of SPEND_CASES) {
  test(testCase.name, async () => {
    const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
    const thread = createThread(store, tempDir('kira-chat-space-'));

    for (const step of testCase.store) {
      step(thread);
    }

    const conversation = await resumeConversation(store, thread.threadId, MODELS);
    const usage = conversation.chatUsage();
    conversation.close();
    store.close();

    assert.equal(usage.spent, testCase.spent);

    // How full the window is comes from pi, which reads it against the model's
    // own window rather than anything this side counts. The fixture's catalog
    // said nothing about one, so it is the default the desktop fills in.
    assert.equal(usage.context?.window, 128_000);
  });
}

test('opening a chat works out what it is holding, and a fork starts holding it', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-chat-space-'));
  ask('Fix the auth bug in the login flow')(thread);
  const asked = thread.sessionManager.getEntries().at(-1);
  assert.ok(asked, 'the question is stored');

  // Opening a chat works out what it is holding and writes it down, with nothing
  // to ask: the observer is the compaction's own extractors run over the chat's
  // own entries, so this is the whole of what it costs.
  const open = await resumeConversation(store, thread.threadId, MODELS);

  // Read as the window reads it, not out of the table: what this has to prove is
  // that the chat can hand its memory on, and the store is only how it is kept.
  assert.deepEqual(open.memory(), [
    {
      kind: 'goal',
      at: asked.timestamp,
      text: 'Fix the auth bug in the login flow',
    },
  ]);

  // A fork is the same work continued, so it starts holding what its source was
  // holding rather than setting out by asking again what the work was.
  const forked = await forkConversation(store, open.threadId, asked.id, MODELS);
  const forkedId = forked.threadId;
  forked.close();

  assert.deepEqual(heldFacts(store, forkedId), [
    { kind: 'goal', text: 'Fix the auth bug in the login flow' },
  ]);
  open.close();
});

/** What a chat is holding, as the judgement in a case reads it. */
function heldFacts(store: ThreadStore, threadId: string): { kind: string; text: string }[] {
  return store.loadObservations(threadId).map(({ kind, text }) => ({ kind, text }));
}

test('memory off stops what a chat works out, and does not throw away what it had', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-chat-space-'));
  ask('Fix the auth bug in the login flow')(thread);
  reply({ type: 'text', text: 'Looking at the login flow now.' })(thread);

  // Opened with memory running: what the chat is holding is worked out from the
  // branch and written down. It is free — the same extractors the compaction runs —
  // which is why the observer is this and not a model.
  const remembering = await resumeConversation(store, thread.threadId, MODELS);
  const holding = remembering.memory();
  remembering.close();

  assert.ok(holding.length > 0, 'a chat with memory on worked nothing out');
  const written = heldFacts(store, thread.threadId);

  // Opened with memory off: nothing is worked out, and nothing is shown either. A
  // strip of what Kira remembers beside a chat that carries none of it into its
  // summaries would say something untrue about what she is working from.
  const forgetting = await resumeConversation(store, thread.threadId, MODELS, () => ({
    enabled: false,
    chosen: null,
    recommended: null,
  }));
  const shown = forgetting.memory();
  forgetting.close();

  assert.deepEqual(shown, []);

  // What was written down before is still there: memory off stops the remembering
  // rather than undoing it, so turning it back on has something waiting.
  assert.deepEqual(heldFacts(store, thread.threadId), written);

  store.close();
});

test('a chat shows what it has worked out, and how far it had read', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-chat-space-'));
  ask('Fix the auth bug in the login flow')(thread);

  // A conclusion is drawn by the reflector, which is a model call, so the test
  // writes them the way the store does rather than spending one to get them.
  store.recordReflections(thread.threadId, [
    { text: 'The auth bug is in the session lookup', coversThrough: 1 },
  ]);

  const open = await resumeConversation(store, thread.threadId, MODELS);

  // Read as the window reads it. What she worked out is not a thing she was told,
  // so it does not arrive as a kind: the pane is given it apart, with the turn the
  // reflector had been shown when it drew it.
  assert.deepEqual(open.conclusions(), [
    { text: 'The auth bug is in the session lookup', coversThrough: 1 },
  ]);
  open.close();

  store.close();
});

test('memory off stops showing what a chat worked out, and does not throw it away', async () => {
  const store = new ThreadStore(join(tempDir('kira-chat-store-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-chat-space-'));
  ask('Fix the auth bug in the login flow')(thread);
  store.recordReflections(thread.threadId, [
    { text: 'The queue was rejected for ingest', coversThrough: 1 },
  ]);

  const remembering = await resumeConversation(store, thread.threadId, MODELS);
  assert.deepEqual(remembering.conclusions(), [
    { text: 'The queue was rejected for ingest', coversThrough: 1 },
  ]);
  remembering.close();

  // Off is off for this too, and for the same reason it is off for what she was
  // told: a conclusion drawn from turns this chat is no longer carrying into its
  // summaries would say something untrue about what she is working from.
  const forgetting = await resumeConversation(store, thread.threadId, MODELS, () => ({
    enabled: false,
    chosen: null,
    recommended: null,
  }));
  assert.deepEqual(forgetting.conclusions(), []);
  forgetting.close();

  // Still in the table, as what she was told still is: memory off stops the
  // remembering rather than undoing it.
  assert.deepEqual(
    store
      .loadReflections(thread.threadId)
      .map(({ text, coversThrough }) => ({ text, coversThrough })),
    [{ text: 'The queue was rejected for ingest', coversThrough: 1 }],
  );

  store.close();
});
