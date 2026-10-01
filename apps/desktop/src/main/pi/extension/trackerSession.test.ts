import { strict as assert } from 'node:assert';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ChatEvent, Ticket, TicketChange } from '../../../preload/bridge.ts';
import { ThreadStore } from '../../db/threads.ts';
import { startConversation } from '../conversations.ts';
import { kiraModels } from '../models.ts';
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
  status: 'draft',
  blocked: false,
  rank: 0,
  priority: 'none',
  pullRequestUrl: null,
  assignee: null,
  tags: [],
  author: null,
  gates: [],
  children: [],
  parent: null,
  subIssues: [],
  relationships: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function streamAnswer(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.end(`data: ${JSON.stringify(body)}\n\ndata: [DONE]\n\n`);
}

test('a real Kira session starts an unattached project ticket and records its chat link', async (t) => {
  const previousHome = process.env['HOME'];
  const previousAgentDir = process.env['PI_CODING_AGENT_DIR'];
  process.env['HOME'] = mkdtempSync(join(tmpdir(), 'kira-tracker-session-home-'));
  process.env['PI_CODING_AGENT_DIR'] = mkdtempSync(join(tmpdir(), 'kira-tracker-session-agent-'));
  t.after(() => {
    if (previousHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = previousHome;
    if (previousAgentDir === undefined) delete process.env['PI_CODING_AGENT_DIR'];
    else process.env['PI_CODING_AGENT_DIR'] = previousAgentDir;
  });

  const requests: Array<Record<string, unknown>> = [];
  const events: ChatEvent[] = [];
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
          : {
              name: 'tracker_update_ticket',
              arguments: '{"ref":"FND-1","body":"Updated","status":"running"}',
            };
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

    if (providerCalls === 3) {
      assert.ok(
        events.some(
          (event) => event.type === 'progress' && event.workTicketIds?.includes('ticket-1'),
        ),
      );
      assert.ok(!events.some((event) => event.type === 'transcript'));
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
    join(mkdtempSync(join(tmpdir(), 'kira-tracker-session-')), 'threads.db'),
  );
  const workspace = store.rememberWorkspace(
    mkdtempSync(join(tmpdir(), 'kira-tracker-session-space-')),
  );
  store.joinWorkspace(workspace.id, draft.projectId);
  const spec = { ...draft, id: 'spec-1', name: 'FND-0', kind: 'spec' as const };
  const foreign = {
    ...draft,
    id: 'foreign-1',
    projectId: 'project-2',
    body: 'Foreign private body',
  };
  const cachePath = join(
    mkdtempSync(join(tmpdir(), 'kira-tracker-session-models-')),
    'models.json',
  );
  writeFileSync(
    cachePath,
    JSON.stringify({ models: [{ id: 'served-model', name: 'Served Model' }] }),
  );
  const models = kiraModels({
    server: `http://127.0.0.1:${address.port}`,
    cachePath,
    token: async () => 'device-key',
    catalog: async () => ({ kind: 'unavailable' as const }),
  });
  const calls: string[] = [];
  let edited = { ...draft, status: 'ready' as Ticket['status'] };
  const answer = <T>(body: T): TrackerAnswer<T> => ({ kind: 'ok', body });
  const wire = {
    currentUser: async () => answer({ id: 'ada' }),
    queue: async (key: string, projectId: string) => {
      calls.push(`queue:${key}:${projectId}`);
      return answer({ tickets: [edited] });
    },
    readTicket: async (key: string, ref: string) => {
      calls.push(`read:${key}:${ref}`);
      return answer(ref === spec.id ? spec : ref === foreign.id ? foreign : edited);
    },
    changeTicket: async (key: string, ticketId: string, change: TicketChange) => {
      calls.push(`change:${key}:${ticketId}`);
      edited = {
        ...edited,
        body: change.body ?? edited.body,
        status: change.status ?? edited.status,
        assignee: change.assigneeId ? { id: change.assigneeId, name: 'Ada' } : edited.assignee,
      };
      return answer(edited);
    },
  } as unknown as TrackerWire;
  const tracker = trackerFor({
    token: async () => 'device-key',
    projectOf: (workspaceId) => store.findWorkspace(workspaceId)?.projectId ?? null,
    joinLocally: () => undefined,
    wire,
  });

  const conversation = await startConversation(
    store,
    workspace.folder,
    models,
    { id: 'thread-1', workspaceId: workspace.id, workTicketIds: [spec.id, foreign.id] },
    undefined,
    tracker,
  );
  conversation.subscribe((event) => events.push(event));
  try {
    await conversation.send('Work on the first actionable ticket.');
    const firstRequest = requests[0];
    assert.ok(firstRequest);
    const toolNames = (firstRequest.tools as Array<{ function: { name: string } }>).map(
      (tool) => tool.function.name,
    );
    assert.deepEqual(calls, [
      'read:device-key:spec-1',
      'read:device-key:foreign-1',
      'queue:device-key:project-1',
      'read:device-key:FND-1',
      'change:device-key:ticket-1',
    ]);
    assert.ok(toolNames.includes('tracker_queue'));
    assert.ok(toolNames.includes('tracker_read_ticket'));
    assert.ok(toolNames.includes('tracker_read_glossary'));
    assert.ok(toolNames.includes('tracker_read_decisions'));
    assert.ok(toolNames.includes('propose_decision'));
    assert.ok(toolNames.includes('tracker_update_ticket'));
    assert.ok(
      !toolNames.some((name) => /publish|ready|approve|create.*decision|supersede/i.test(name)),
    );
    const systemPrompt = (firstRequest.messages as Array<{ role: string; content?: string }>).find(
      (message) => message.role === 'system',
    )?.content;
    assert.match(systemPrompt ?? '', /Workflow router/);
    assert.match(systemPrompt ?? '', /to-spec/);
    assert.match(systemPrompt ?? '', /attach its HTTPS URL and set Needs review/);
    assert.match(systemPrompt ?? '', /no remote, set Needs review without a PR link/);
    assert.match(
      systemPrompt ?? '',
      /remote exists but publishing or opening the PR fails, leave the ticket Running/,
    );
    assert.match(systemPrompt ?? '', /Never mark a ticket Done/);
    assert.match(systemPrompt ?? '', /Attachments provide context, not permission/);
    assert.match(systemPrompt ?? '', /current project, attached or not/);
    assert.doesNotMatch(systemPrompt ?? '', /only for tickets linked to this chat/);
    assert.doesNotMatch(systemPrompt ?? '', /Foreign private body/);
    assert.match(systemPrompt ?? '', /choosing one ready, unblocked ticket/);
    assert.equal(edited.body, 'Updated');
    assert.equal(edited.status, 'running');
    assert.deepEqual(edited.assignee, { id: 'ada', name: 'Ada' });
    assert.deepEqual(store.getThread(conversation.threadId).workTicketIds, [
      spec.id,
      foreign.id,
      draft.id,
    ]);

    store.joinWorkspace(workspace.id, foreign.projectId);
    await conversation.send('Read the attached context.');
    const promptOf = (request: Record<string, unknown>) =>
      (request.messages as Array<{ role: string; content?: string }>).find(
        (message) => message.role === 'system',
      )?.content ?? '';
    const movedPrompt = promptOf(requests.at(-1)!);
    assert.match(movedPrompt, /Foreign private body/);
    assert.doesNotMatch(movedPrompt, /A draft|\(id: spec-1\)|\(id: ticket-1\)/);

    const unjoined = store.rememberWorkspace(mkdtempSync(join(tmpdir(), 'kira-unjoined-')));
    store.fileThread(conversation.threadId, unjoined);
    const readsBefore = calls.filter((call) => call.startsWith('read:')).length;
    await conversation.send('Read the attached context.');
    assert.doesNotMatch(
      promptOf(requests.at(-1)!),
      /Attached project tickets|Foreign private body/,
    );
    assert.equal(calls.filter((call) => call.startsWith('read:')).length, readsBefore);
  } finally {
    conversation.close();
    store.close();
    await new Promise<void>((resolve, reject) =>
      provider.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
