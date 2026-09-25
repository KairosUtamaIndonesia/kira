import { strict as assert } from 'node:assert';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Ticket } from '../../../preload/bridge.ts';
import { ThreadStore } from '../../db/threads.ts';
import { startConversation } from '../conversations.ts';
import { foundryModels } from '../models.ts';
import { trackerFor, type TrackerAnswer, type TrackerWire } from '../../tracker.ts';

const draft: Ticket = {
  id: 'ticket-1',
  projectId: 'project-1',
  name: 'FND-1',
  number: 1,
  kind: 'feature',
  title: 'A ticket',
  body: 'A draft',
  criteria: ['It is testable'],
  gate: 'draft',
  band: 'draft',
  rank: 0,
  branch: 'fnd-1-a-ticket',
  author: null,
  gates: [],
  children: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  closedAt: null,
  closure: null,
  claim: null,
  runs: [],
};

function streamAnswer(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.end(`data: ${JSON.stringify(body)}\n\ndata: [DONE]\n\n`);
}

test('a real Kira session reads and edits through the main-process tracker seam', async (t) => {
  const previousHome = process.env['HOME'];
  const previousAgentDir = process.env['PI_CODING_AGENT_DIR'];
  process.env['HOME'] = mkdtempSync(join(tmpdir(), 'foundry-tracker-session-home-'));
  process.env['PI_CODING_AGENT_DIR'] = mkdtempSync(
    join(tmpdir(), 'foundry-tracker-session-agent-'),
  );
  t.after(() => {
    if (previousHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = previousHome;
    if (previousAgentDir === undefined) delete process.env['PI_CODING_AGENT_DIR'];
    else process.env['PI_CODING_AGENT_DIR'] = previousAgentDir;
  });

  const requests: Array<Record<string, unknown>> = [];
  let providerCalls = 0;
  const provider = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text) as Record<string, unknown>;
    requests.push(body);
    providerCalls += 1;

    if (providerCalls < 3) {
      const tool =
        providerCalls === 1
          ? { name: 'tracker_queue', arguments: '{}' }
          : { name: 'tracker_edit_draft', arguments: '{"ref":"FND-1","body":"Updated"}' };
      streamAnswer(response, {
        id: `chatcmpl-tool-${providerCalls}`,
        object: 'chat.completion.chunk',
        model: 'served-model',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: `call-${providerCalls}`,
                  type: 'function',
                  function: tool,
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });
      return;
    }

    streamAnswer(response, {
      id: 'chatcmpl-final',
      object: 'chat.completion.chunk',
      model: 'served-model',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'The draft is updated.' },
          finish_reason: 'stop',
        },
      ],
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address();
  if (address === null || typeof address === 'string') throw new Error('the provider has no port');

  const store = new ThreadStore(
    join(mkdtempSync(join(tmpdir(), 'foundry-tracker-session-')), 'threads.db'),
  );
  const workspace = store.rememberWorkspace(
    mkdtempSync(join(tmpdir(), 'foundry-tracker-session-space-')),
  );
  const cachePath = join(
    mkdtempSync(join(tmpdir(), 'foundry-tracker-session-models-')),
    'models.json',
  );
  writeFileSync(
    cachePath,
    JSON.stringify({ models: [{ id: 'served-model', name: 'Served Model' }] }),
  );
  const models = foundryModels({
    server: `http://127.0.0.1:${address.port}`,
    cachePath,
    token: async () => 'device-key',
    catalog: async () => ({ kind: 'unavailable' as const }),
  });
  const calls: string[] = [];
  let edited = draft;
  const answer = <T>(body: T): TrackerAnswer<T> => ({ kind: 'ok', body });
  const wire = {
    queue: async (key: string, projectId: string) => {
      calls.push(`queue:${key}:${projectId}`);
      return answer({ tickets: [edited] });
    },
    readTicket: async (key: string, ref: string) => {
      calls.push(`read:${key}:${ref}`);
      return answer(edited);
    },
    changeTicket: async (key: string, ticketId: string, change: { body?: string }) => {
      calls.push(`change:${key}:${ticketId}`);
      edited = { ...edited, body: change.body ?? edited.body };
      return answer(edited);
    },
  } as unknown as TrackerWire;
  const tracker = trackerFor({
    token: async () => 'device-key',
    projectOf: (workspaceId) => (workspaceId === workspace.id ? workspace.id : null),
    joinLocally: () => undefined,
    wire,
  });

  const conversation = await startConversation(
    store,
    workspace.folder,
    models,
    { id: 'thread-1', workspaceId: workspace.id },
    undefined,
    tracker,
  );
  try {
    await conversation.send('Read the queue and update the draft.');
    const firstRequest = requests[0];
    assert.ok(firstRequest);
    const toolNames = (firstRequest.tools as Array<{ function: { name: string } }>).map(
      (tool) => tool.function.name,
    );
    assert.deepEqual(calls, [
      `queue:device-key:${workspace.id}`,
      'read:device-key:FND-1',
      'change:device-key:ticket-1',
    ]);
    assert.ok(toolNames.includes('tracker_queue'));
    assert.ok(toolNames.includes('tracker_read_ticket'));
    assert.ok(toolNames.includes('tracker_read_glossary'));
    assert.ok(toolNames.includes('tracker_read_decisions'));
    assert.ok(toolNames.includes('propose_decision'));
    assert.ok(toolNames.includes('tracker_edit_draft'));
    assert.ok(
      !toolNames.some((name) => /publish|ready|approve|create.*decision|supersede/i.test(name)),
    );
    const systemPrompt = (firstRequest.messages as Array<{ role: string; content?: string }>).find(
      (message) => message.role === 'system',
    )?.content;
    assert.match(systemPrompt ?? '', /Workflow router/);
    assert.match(systemPrompt ?? '', /to-spec/);
    assert.equal(edited.body, 'Updated');
  } finally {
    conversation.close();
    store.close();
    await new Promise<void>((resolve, reject) =>
      provider.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
