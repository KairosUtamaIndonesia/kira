import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import { ThreadStore } from '../db/threads.ts';
import { Questionnaires } from '../questionnaires.ts';
import { tempDir } from '../test-support/temp.ts';
import { resumeConversation, subagentTranscriptIn } from './conversations.ts';
import { subagentTool } from './extension/subagentTool.ts';
import { kiraModels, type Models } from './models.ts';
import { openChats } from './openChats.ts';
import { createThread } from './storage.ts';
import type { SubagentManager } from './subagents.ts';

// Hermetic, as the other booting tests are: pi reads `PI_CODING_AGENT_DIR` for
// settings and credentials and `HOME` for the global skills source.
process.env['HOME'] = tempDir('kira-subagent-wiring-home-');
process.env['PI_CODING_AGENT_DIR'] = tempDir('kira-subagent-wiring-agent-');

function models(server = 'http://localhost:4100'): Models {
  const cache = join(tempDir('kira-subagent-wiring-models-'), 'models.json');
  writeFileSync(cache, JSON.stringify({ models: [{ id: 'served-model', name: 'Served Model' }] }));

  return kiraModels({
    server,
    cachePath: cache,
    token: async () => 'device-key',
    catalog: async () => ({ kind: 'unavailable' }),
  });
}

async function subagentProvider(options: {
  childAsksQuestion?: boolean;
  holdChild?: boolean;
} = {}): Promise<{
  url: string;
  requests: {
    tools?: { function?: { name?: string } }[];
    messages?: { role?: string; content?: unknown }[];
  }[];
  childStarted: Promise<void>;
  releaseChild(): void;
  stop(): Promise<void>;
}> {
  const requests: {
    tools?: { function?: { name?: string } }[];
    messages?: { role?: string; content?: unknown }[];
  }[] = [];
  let childStarted!: () => void;
  const childRequestStarted = new Promise<void>((resolve) => {
    childStarted = resolve;
  });
  let releaseChild!: () => void;
  const childGate = new Promise<void>((resolve) => {
    releaseChild = resolve;
  });
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', async () => {
      const asked = JSON.parse(body) as {
        tools?: { function?: { name?: string } }[];
        messages?: { role?: string; content?: unknown }[];
      };
      requests.push(asked);
      const isParent = asked.tools?.some((tool) => tool.function?.name === 'subagent') ?? false;
      const hasToolResult = asked.messages?.some((message) => message.role === 'tool') ?? false;
      const asksParent =
        options.childAsksQuestion === true &&
        isParent &&
        asked.messages?.some(
          (message) =>
            message.role === 'user' &&
            typeof message.content === 'string' &&
            message.content.includes('A delegated child needs an answer'),
        );
      const asksPerson =
        options.childAsksQuestion === true &&
        !isParent &&
        asked.tools?.some((tool) => tool.function?.name === 'ask_user_question') &&
        !hasToolResult;
      const delegates = isParent && !hasToolResult && !asksParent;
      const asksQuestion = Boolean(asksPerson);
      if (options.holdChild === true && !isParent) {
        childStarted();
        await childGate;
      }
      const frame = {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1,
        model: 'served-model',
      };
      const events =
        delegates || asksQuestion
          ? [
              {
                ...frame,
                choices: [
                  {
                    index: 0,
                    delta: {
                      role: 'assistant',
                      tool_calls: [
                        {
                          index: 0,
                          id: delegates ? 'call-child' : 'call-question',
                          type: 'function',
                          function: {
                            name: delegates ? 'subagent' : 'ask_user_question',
                            arguments: JSON.stringify(
                              delegates
                                ? {
                                    action: 'spawn',
                                    role: 'explore',
                                    task: 'Read src/retry.ts and summarize the retry behavior.',
                                  }
                                : {
                                    questions: [
                                      {
                                        question: 'Which cache should this use?',
                                        header: 'Cache',
                                        options: [
                                          { label: 'Memory', description: 'Local only.' },
                                          { label: 'Redis', description: 'Shared.' },
                                        ],
                                      },
                                    ],
                                  },
                            ),
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              },
              { ...frame, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
            ]
          : [
              {
                ...frame,
                choices: [
                  {
                    index: 0,
                    delta: {
                      role: 'assistant',
                      content: asksParent
                        ? 'Use Redis; the project notes specify a shared cache.'
                        : isParent
                          ? 'Delegation started.'
                          : options.childAsksQuestion
                            ? 'I will use Redis as Kira advised.'
                            : 'Retry uses three attempts.',
                    },
                    finish_reason: null,
                  },
                ],
              },
              { ...frame, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
            ];
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
      response.write(
        `data: ${JSON.stringify({ ...frame, choices: [], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } })}\n\n`,
      );
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No local provider port.');
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    childStarted: childRequestStarted,
    releaseChild: () => releaseChild(),
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

test('the delegation tool hands the task to the manager and answers with the child', async () => {
  const spawned: { role: string; prompt: string }[] = [];
  const manager: SubagentManager = {
    spawn: (input) => {
      spawned.push({ role: input.role, prompt: input.prompt });
      return 'child-1';
    },
    list: () => [],
    activity: () => {},
    stop: async () => {},
    stopAll: async () => {},
    steer: async () => {},
    resume: async () => {},
    askParent: async () => null,
    settle: async () => {},
    subscribe: () => () => {},
    dispose: () => {},
  };

  const tool = subagentTool(manager);
  const result = await tool.execute(
    'call-1',
    { action: 'spawn', role: 'explore', task: 'Find the retry.' },
    undefined,
    undefined,
    {} as never,
  );

  assert.deepEqual(spawned, [{ role: 'explore', prompt: 'Find the retry.' }]);
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
  assert.match(text, /child-1/);
});

test('a child report in a chat reads as its own message, not Kira’s', async () => {
  const store = new ThreadStore(join(tempDir('kira-subagent-wiring-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-subagent-wiring-work-'));

  const report: Parameters<SessionManager['appendMessage']>[0] = {
    role: 'custom',
    customType: 'subagent-report',
    content: 'The retry lives in session.ts.',
    display: true,
    timestamp: 42,
  };
  thread.sessionManager.appendMessage(report);

  const conversation = await resumeConversation(store, thread.threadId, models());
  const said = conversation.transcript().messages.find((message) => message.role === 'subagent');

  assert.ok(said, 'the report is a message in the chat');
  assert.deepEqual(said.parts, [{ type: 'text', text: 'The retry lives in session.ts.' }]);

  conversation.close();
  store.close();
});

test('a real parent session runs a real child turn and publishes its report separately', async () => {
  const provider = await subagentProvider();
  const databasePath = join(tempDir('kira-subagent-real-turn-'), 'threads.db');
  const store = new ThreadStore(databasePath);
  const thread = createThread(store, tempDir('kira-subagent-real-work-'));
  const conversation = await resumeConversation(store, thread.threadId, models(provider.url));
  let childId: string | null = null;
  let unsubscribe = () => {};
  const settled = new Promise<void>((resolve) => {
    unsubscribe = conversation.subscribe((event) => {
      if (event.type === 'subagents' && event.settled) resolve();
    });
  });

  try {
    await conversation.send('Delegate this bounded investigation.');
    await settled;
    const child = conversation.subagents()[0];
    assert.ok(child);
    childId = child.id;
    assert.equal(child.state, 'complete');
    assert.equal(child.outcome, 'Retry uses three attempts.');
    assert.ok(
      conversation
        .transcript()
        .messages.some(
          (message) =>
            message.role === 'subagent' &&
            message.parts.some(
              (part) => part.type === 'text' && part.text === 'Retry uses three attempts.',
            ),
        ),
    );
    assert.ok(conversation.subagentTranscript(child.id).messages.length > 0);
  } finally {
    unsubscribe();
    conversation.close();
    store.close();
    await provider.stop();
  }

  assert.ok(childId);
  const reopened = new ThreadStore(databasePath);
  try {
    assert.equal(reopened.getThread(childId).subagent?.response, 'Retry uses three attempts.');
    assert.ok(
      subagentTranscriptIn(reopened, thread.threadId, childId).messages.some((message) =>
        message.parts.some(
          (part) => part.type === 'text' && part.text === 'Retry uses three attempts.',
        ),
      ),
    );
  } finally {
    reopened.close();
  }
});

test('closing a chat stops its running child and settles its stored state', async () => {
  const provider = await subagentProvider({ holdChild: true });
  const store = new ThreadStore(join(tempDir('kira-subagent-close-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-subagent-close-work-'));
  const otherThread = createThread(store, tempDir('kira-subagent-close-other-work-'));
  const chats = openChats(
    store,
    () => {},
    () => tempDir('kira-subagent-close-new-work-'),
    models(provider.url),
  );

  try {
    await chats.open(thread.threadId);
    await chats.send('Delegate this bounded investigation.');
    await provider.childStarted;

    const child = chats.state().subagents?.[0];
    assert.ok(child);
    assert.equal(child.state, 'running');
    assert.ok(chats.state().running.includes(thread.threadId));

    await chats.open(otherThread.threadId);
    assert.equal(chats.state().currentId, otherThread.threadId);
    assert.ok(chats.state().chats.some((chat) => chat.id === thread.threadId));
    assert.ok(chats.state().running.includes(thread.threadId));

    await chats.open(thread.threadId);
    await assert.rejects(chats.archiveChat(thread.threadId), /Kira is writing/);

    chats.closeAll();

    assert.equal(store.getThread(child.id).subagent?.status, 'stopped');
    assert.equal(store.getThread(child.id).subagent?.activity, 'Stopped');
  } finally {
    chats.closeAll();
    provider.releaseChild();
    store.close();
    await provider.stop();
  }
});

test('a real child asks its owning Kira before opening a person questionnaire', async () => {
  const provider = await subagentProvider({ childAsksQuestion: true });
  const store = new ThreadStore(join(tempDir('kira-subagent-question-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-subagent-question-work-'));
  let questionnaireOpened = false;
  const questionnaires = new Questionnaires((event) => {
    if (event.type === 'questionnaire-opened') questionnaireOpened = true;
  });
  const conversation = await resumeConversation(
    store,
    thread.threadId,
    models(provider.url),
    undefined,
    undefined,
    undefined,
    undefined,
    questionnaires,
  );
  let unsubscribe = () => {};
  const settled = new Promise<void>((resolve) => {
    unsubscribe = conversation.subscribe((event) => {
      if (event.type === 'subagents' && event.settled) resolve();
    });
  });

  try {
    await conversation.send('Delegate an investigation and ask me only if the chat cannot answer.');
    await settled;
    const child = conversation.subagents()[0];
    assert.ok(child);
    assert.equal(child.state, 'complete');
    assert.equal(questionnaireOpened, false);
    assert.equal(child.outcome, 'I will use Redis as Kira advised.');
    assert.ok(
      provider.requests.some(
        (request) =>
          request.tools?.some((tool) => tool.function?.name === 'subagent') &&
          JSON.stringify(request.messages).includes('A delegated child needs an answer'),
      ),
      `the child question reaches the owning chat session: ${JSON.stringify(provider.requests.map(({ tools, messages }) => ({ toolNames: tools?.map((tool) => tool.function?.name), messages })))}`,
    );
    assert.ok(
      provider.requests.some((request) =>
        JSON.stringify(request.messages).includes('Kira answered your question'),
      ),
      'the child receives Kira’s answer before completing',
    );
  } finally {
    unsubscribe();
    conversation.close();
    store.close();
    await provider.stop();
  }
});

test('a pending child questionnaire is included in its parent chat state', async () => {
  const store = new ThreadStore(join(tempDir('kira-subagent-question-state-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-subagent-question-state-work-'));
  const child = store.createThread(thread.cwd, {
    parentThreadId: thread.threadId,
    subagent: {
      role: 'explore',
      prompt: 'Choose a cache based on the project requirements.',
      context: 'task',
      modelId: 'served-model',
      status: 'stopped',
      response: '',
      error: null,
      activity: 'Stopped',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    },
  });
  const secondChild = store.createThread(thread.cwd, {
    parentThreadId: thread.threadId,
    subagent: {
      role: 'explore',
      prompt: 'Choose a cache based on the project requirements.',
      context: 'task',
      modelId: 'served-model',
      status: 'stopped',
      response: '',
      error: null,
      activity: 'Stopped',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    },
  });
  const questionnaires = new Questionnaires(() => {});
  const chats = openChats(
    store,
    () => {},
    () => tempDir('kira-subagent-question-state-new-work-'),
    models(),
    undefined,
    undefined,
    undefined,
    undefined,
    questionnaires,
  );

  try {
    await chats.open(thread.threadId);
    const params = {
      questions: [
        {
          question: 'Which cache should this use?',
          header: 'Cache',
          options: [
            { label: 'Memory', description: 'Local only.' },
            { label: 'Redis', description: 'Shared.' },
          ],
        },
      ],
    };
    const answers = new Map([
      [child.id, questionnaires.ask(child.id, params)],
      [secondChild.id, questionnaires.ask(secondChild.id, params)],
    ]);

    const request = chats.state().questionnaire;
    assert.ok(request);
    assert.ok(answers.has(request.threadId));
    assert.equal(
      questionnaires.submit(child.id, request.requestId, {
        cancelled: false,
        answers: [
          {
            questionIndex: 0,
            question: request.questions[0]?.question,
            kind: 'option',
            answer: 'Redis',
          },
        ],
      }),
      request.threadId === child.id,
    );
    if (request.threadId !== child.id) {
      assert.equal(
        questionnaires.submit(secondChild.id, request.requestId, {
          cancelled: false,
          answers: [
            {
              questionIndex: 0,
              question: request.questions[0]?.question,
              kind: 'option',
              answer: 'Redis',
            },
          ],
        }),
        true,
      );
    }
    assert.equal((await answers.get(request.threadId))?.cancelled, false);

    const next = chats.state().questionnaire;
    assert.ok(next);
    assert.notEqual(next.threadId, request.threadId);
    assert.equal(
      questionnaires.submit(next.threadId, next.requestId, {
        cancelled: false,
        answers: [
          {
            questionIndex: 0,
            question: next.questions[0]?.question,
            kind: 'option',
            answer: 'Redis',
          },
        ],
      }),
      true,
    );
    assert.equal((await answers.get(next.threadId))?.cancelled, false);
  } finally {
    chats.closeAll();
    questionnaires.closeAll();
    store.close();
  }
});
