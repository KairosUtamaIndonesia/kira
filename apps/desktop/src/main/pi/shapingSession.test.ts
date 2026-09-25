import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ThreadStore } from '../db/threads.ts';
import type { Proposal } from '../../preload/bridge.ts';
import type { Tracker } from '../tracker.ts';
import { openChats, type OpenChats } from './openChats.ts';
import { kiraModels } from './models.ts';
import { createThread } from './storage.ts';

process.env['HOME'] = mkdtempSync(join(tmpdir(), 'kira-shaping-home-'));
process.env['PI_CODING_AGENT_DIR'] = mkdtempSync(join(tmpdir(), 'kira-shaping-agent-'));

/** One streamed provider reply: words, or a single tool call. */
type Reply = { say: string } | { call: string; arguments: Record<string, unknown> };

function streamed(reply: Reply): string {
  const delta =
    'say' in reply
      ? { role: 'assistant', content: reply.say }
      : {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `call-${reply.call}`,
              type: 'function',
              function: { name: reply.call, arguments: JSON.stringify(reply.arguments) },
            },
          ],
        };
  return `data: ${JSON.stringify({
    id: 'reply',
    object: 'chat.completion.chunk',
    model: 'served-model',
    choices: [{ index: 0, delta, finish_reason: 'say' in reply ? 'stop' : 'tool_calls' }],
  })}\n\ndata: [DONE]\n\n`;
}

/**
 * A real chat in a workspace, running against a provider that answers `replies`
 * in order. Every tracker call is recorded, so a case can see that nothing was
 * written.
 */
async function shapingChat(
  replies: Reply[],
  tracker?: Tracker,
): Promise<{
  chats: OpenChats;
  threadId: string;
  systemPrompts: () => string[];
  trackerCalls: string[];
  close: () => Promise<void>;
}> {
  const requests: Array<{ messages: Array<{ role: string; content?: string }> }> = [];
  const provider = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push(
        JSON.parse(Buffer.concat(chunks).toString('utf8')) as (typeof requests)[number],
      );
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(streamed(replies[requests.length - 1] ?? { say: 'Done.' }));
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address();
  if (address === null || typeof address === 'string') throw new Error('the provider has no port');

  const store = new ThreadStore(
    join(mkdtempSync(join(tmpdir(), 'kira-shaping-store-')), 'threads.db'),
  );
  const workspace = store.rememberWorkspace(mkdtempSync(join(tmpdir(), 'kira-shaping-space-')));
  const thread = createThread(store, workspace.folder, { workspaceId: workspace.id });
  const cachePath = join(mkdtempSync(join(tmpdir(), 'kira-shaping-models-')), 'models.json');
  writeFileSync(cachePath, JSON.stringify({ models: [{ id: 'served-model', name: 'Served' }] }));
  const models = kiraModels({
    server: `http://127.0.0.1:${address.port}`,
    cachePath,
    token: async () => 'device-key',
    catalog: async () => ({ kind: 'unavailable' as const }),
  });
  const trackerCalls: string[] = [];
  const recording = new Proxy({} as Tracker, {
    get: (_target, name) =>
      name === 'then'
        ? undefined
        : async () => {
            trackerCalls.push(String(name));
            throw new Error('Nothing should reach the tracker.');
          },
  });
  const chats = openChats(
    store,
    () => {},
    () => mkdtempSync(join(tmpdir(), 'unused-')),
    models,
    undefined,
    tracker ?? recording,
  );
  await chats.open(thread.threadId);

  return {
    chats,
    threadId: thread.threadId,
    systemPrompts: () =>
      requests.map(
        (request) => request.messages.find((message) => message.role === 'system')?.content ?? '',
      ),
    trackerCalls,
    close: async () => {
      chats.closeAll();
      store.close();
      await new Promise<void>((resolve, reject) =>
        provider.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

test('a concrete idea gets an ordinary reply with no interview injected into the next turn', async () => {
  const session = await shapingChat([
    { say: 'Who is this queue view for?' },
    { say: 'Noted. What should it show first?' },
  ]);

  try {
    await session.chats.send('I want to build a new queue view.');
    await session.chats.send('Contributors deciding what to pick up.');

    const prompts = session.systemPrompts();
    assert.equal(prompts.length, 2);
    // The procedure lives in skills now: the server's prompt is the same on
    // every turn, whatever has been said, and carries no scripted question.
    assert.doesNotMatch(prompts.join('\n'), /^Question: |Recommended answer: /m);
    assert.doesNotMatch(prompts.join('\n'), /Spec mode: planning-only/);
    assert.deepEqual(session.chats.state().shaping?.proposals, []);
    assert.deepEqual(session.trackerCalls, []);
  } finally {
    await session.close();
  }
});

test('a spec proposal from Kira joins the proposal list without writing to the tracker', async () => {
  const session = await shapingChat([
    {
      call: 'shape_spec_proposal',
      arguments: {
        problem: 'The queue hides which work is agreed.',
        solution: 'Show agreed work first.',
        stories: ['A contributor sees agreed work first.'],
      },
    },
    { say: 'The spec is waiting for your approval.' },
  ]);

  try {
    await session.chats.send('I want to build a new queue view.');

    const proposals = session.chats.state().shaping?.proposals ?? [];
    assert.equal(proposals.length, 1, JSON.stringify(session.chats.state().transcript));
    const [spec] = proposals;
    assert.ok(spec?.kind === 'spec');
    assert.deepEqual(
      {
        chatId: spec.chatId,
        problem: spec.problem,
        solution: spec.solution,
        stories: spec.stories,
        status: spec.status,
        ticketId: spec.ticketId,
      },
      {
        chatId: session.threadId,
        problem: 'The queue hides which work is agreed.',
        solution: 'Show agreed work first.',
        stories: ['A contributor sees agreed work first.'],
        status: 'proposed',
        ticketId: null,
      },
    );
    assert.deepEqual(session.trackerCalls, []);
  } finally {
    await session.close();
  }
});

const SPEC = {
  call: 'shape_spec_proposal',
  arguments: {
    problem: 'The queue hides agreed work. It should not.',
    solution: 'Show agreed work first.',
    stories: ['A contributor sees agreed work first.'],
  },
};
const DESTINATION_SPEC = {
  call: SPEC.call,
  arguments: { ...SPEC.arguments, mapTicketId: 'map-1' },
};
const MAP = {
  call: 'propose_map',
  arguments: {
    title: 'Queue overhaul',
    body: 'Too big.',
    criteria: ['c'],
    questions: [],
    research: [],
  },
};
const DECISION = {
  call: 'propose_decision',
  arguments: {
    context: 'Approval is durable.',
    choice: 'Keep it person-owned.',
    rejectedOptions: ['Let Kira publish.'],
    consequences: 'The person decides.',
  },
};
const OUTCOME = {
  call: 'propose_outcome',
  arguments: {
    ticketId: 'question-1',
    answer: 'Keep it person-owned.',
    sources: ['https://example.com'],
    decisionProposal: { ...DECISION.arguments, supersedes: null },
  },
};
const BREAKDOWN = {
  call: 'shape_breakdown_proposal',
  arguments: {
    slices: [{ id: 'a', kind: 'feature', title: 'A', body: 'a', criteria: [], dependsOn: [] }],
  },
};
const READY_REFUSAL = 'FND-2 needs completion criteria before it can be ready.';

/** What a person can see of a proposal once they have acted on it. */
function outcomeOf(proposal: Proposal): Record<string, unknown> {
  switch (proposal.kind) {
    case 'spec':
    case 'map':
      return { kind: proposal.kind, status: proposal.status, ticketId: proposal.ticketId };
    case 'decision':
      return {
        kind: proposal.kind,
        status: proposal.status,
        recorded: proposal.decisionId !== null,
      };
    case 'outcome':
      return { kind: proposal.kind, status: proposal.status, outcomeId: proposal.outcomeId };
    case 'breakdown':
      return {
        kind: proposal.kind,
        status: proposal.status,
        ticketIds: proposal.ticketIds,
        readyRefusal: proposal.readyRefusal,
      };
  }
}

test('a newer explicit Decision is not replaced by an older Outcome suggestion', async () => {
  const session = await shapingChat([OUTCOME, DECISION, { say: 'Waiting for your approval.' }]);

  try {
    await session.chats.send('Settle this question.');
    const decision = session.chats
      .state()
      .shaping?.proposals.find((each) => each.kind === 'decision');
    assert.ok(decision?.kind === 'decision');
    assert.equal(decision.choice, DECISION.arguments.choice);
  } finally {
    await session.close();
  }
});

test('readiness retry reuses published drafts and clears the recorded refusal', async () => {
  let readinessAttempts = 0;
  let publications = 0;
  const tracker = {
    write: async () => ({ id: 'spec-ticket' }),
    change: async (id: string) => ({ id }),
    publishBreakdown: async () => {
      publications += 1;
      return { spec: { id: 'spec-ticket' }, children: [{ id: 'child-a' }] };
    },
    markBreakdownReady: async () => {
      readinessAttempts += 1;
      if (readinessAttempts === 1) throw new Error(READY_REFUSAL);
      return { spec: { id: 'spec-ticket' }, children: [{ id: 'child-a' }] };
    },
  } as unknown as Tracker;
  const session = await shapingChat([SPEC, BREAKDOWN], tracker);

  try {
    await session.chats.send('Make the tickets.');
    const [spec, breakdown] = session.chats.state().shaping?.proposals ?? [];
    assert.ok(spec?.kind === 'spec' && breakdown?.kind === 'breakdown');
    await session.chats.approveProposal(spec.id);
    await session.chats.approveProposal(breakdown.id);
    const refused = session.chats
      .state()
      .shaping?.proposals.find((each) => each.id === breakdown.id);
    assert.ok(refused?.kind === 'breakdown');
    assert.equal(refused.readyRefusal, READY_REFUSAL);

    await session.chats.retryBreakdownReady();

    const retried = session.chats
      .state()
      .shaping?.proposals.find((each) => each.id === breakdown.id);
    assert.ok(retried?.kind === 'breakdown');
    assert.equal(retried.readyRefusal, null);
    assert.equal(publications, 1);
    assert.equal(readinessAttempts, 2);
  } finally {
    await session.close();
  }
});

test('approving a spec in Spec mode automatically proposes its ticket breakdown', async () => {
  const trackerCalls: string[] = [];
  const tracker = {
    write: async () => {
      trackerCalls.push('write spec');
      return { id: 'spec-ticket' };
    },
    change: async () => {
      trackerCalls.push('ready spec');
      return { id: 'spec-ticket' };
    },
  } as unknown as Tracker;
  const session = await shapingChat([SPEC, { say: 'Waiting for approval.' }, BREAKDOWN], tracker);

  try {
    await session.chats.setMode('spec');
    await session.chats.send('Shape the queue change.');
    const spec = session.chats.state().shaping?.proposals.find((each) => each.kind === 'spec');
    assert.ok(spec?.kind === 'spec');

    await session.chats.approveProposal(spec.id);

    const proposals = session.chats.state().shaping?.proposals ?? [];
    assert.deepEqual(
      proposals.map((proposal) => [proposal.kind, proposal.status]),
      [
        ['spec', 'approved'],
        ['breakdown', 'proposed'],
      ],
    );
    assert.deepEqual(trackerCalls, ['write spec', 'ready spec']);
    assert.match(
      session.systemPrompts().at(-1) ?? '',
      /After the person approves the spec, immediately call shape_breakdown_proposal/,
    );
  } finally {
    await session.close();
  }
});

test('a person approves or rejects each kind of proposal through one pair of actions', async () => {
  const cases: Array<{
    name: string;
    /** What Kira proposes, one list of tool calls per turn. */
    turns: Reply[][];
    /** What the person does, in order: the action and the kind and position of the proposal. */
    steps: Array<['approve' | 'reject', Proposal['kind'], number]>;
    refuseReadiness?: true;
    wantError?: string;
    wantCalls: string[];
    want: Record<string, unknown>[];
  }> = [
    {
      name: 'spec',
      turns: [[SPEC]],
      steps: [['approve', 'spec', 0]],
      wantCalls: ['write spec The queue hides agreed work', 'change spec-ticket ready-for-agent'],
      want: [{ kind: 'spec', status: 'approved', ticketId: 'spec-ticket' }],
    },
    {
      name: 'spec that is a map destination',
      turns: [[DESTINATION_SPEC]],
      steps: [['approve', 'spec', 0]],
      wantCalls: ['destination map-1'],
      want: [{ kind: 'spec', status: 'approved', ticketId: 'destination-ticket' }],
    },
    {
      name: 'map',
      turns: [[MAP]],
      steps: [['approve', 'map', 0]],
      wantCalls: ['map Queue overhaul'],
      want: [{ kind: 'map', status: 'approved', ticketId: 'map-ticket' }],
    },
    {
      name: 'Decision',
      turns: [[DECISION]],
      steps: [['approve', 'decision', 0]],
      wantCalls: ['decision Keep it person-owned.'],
      want: [{ kind: 'decision', status: 'approved', recorded: true }],
    },
    {
      name: 'Outcome, leaving the Decision it suggests for the person',
      turns: [[OUTCOME]],
      steps: [['approve', 'outcome', 0]],
      wantCalls: ['outcome question-1'],
      want: [
        { kind: 'outcome', status: 'approved', outcomeId: 'outcome-record' },
        { kind: 'decision', status: 'proposed', recorded: false },
      ],
    },
    {
      name: 'breakdown is published and marked ready in one action',
      turns: [[SPEC, BREAKDOWN]],
      steps: [
        ['approve', 'spec', 0],
        ['approve', 'breakdown', 0],
      ],
      wantCalls: [
        'write spec The queue hides agreed work',
        'change spec-ticket ready-for-agent',
        'publish spec-ticket 1',
        'ready spec-ticket',
      ],
      want: [
        { kind: 'spec', status: 'approved', ticketId: 'spec-ticket' },
        { kind: 'breakdown', status: 'approved', ticketIds: ['child-a'], readyRefusal: null },
      ],
    },
    {
      name: 'breakdown whose readiness the server refuses stays published as drafts',
      turns: [[SPEC, BREAKDOWN]],
      steps: [
        ['approve', 'spec', 0],
        ['approve', 'breakdown', 0],
      ],
      refuseReadiness: true,
      wantCalls: [
        'write spec The queue hides agreed work',
        'change spec-ticket ready-for-agent',
        'publish spec-ticket 1',
        'ready spec-ticket',
      ],
      want: [
        { kind: 'spec', status: 'approved', ticketId: 'spec-ticket' },
        {
          kind: 'breakdown',
          status: 'approved',
          ticketIds: ['child-a'],
          readyRefusal: READY_REFUSAL,
        },
      ],
    },
    {
      name: 'breakdown before any spec is approved',
      turns: [[BREAKDOWN]],
      steps: [['approve', 'breakdown', 0]],
      wantError: 'Approve the spec before approving its breakdown.',
      wantCalls: [],
      want: [{ kind: 'breakdown', status: 'proposed', ticketIds: [], readyRefusal: null }],
    },
    {
      name: 'a replaced proposal cannot be approved',
      turns: [[SPEC], [SPEC]],
      steps: [['approve', 'spec', 0]],
      wantError: 'That proposal is no longer waiting for a decision.',
      wantCalls: [],
      want: [
        { kind: 'spec', status: 'replaced', ticketId: null },
        { kind: 'spec', status: 'proposed', ticketId: null },
      ],
    },
    {
      name: 'reject',
      turns: [[DECISION]],
      steps: [['reject', 'decision', 0]],
      wantCalls: [],
      want: [{ kind: 'decision', status: 'rejected', recorded: false }],
    },
    {
      name: 'a rejected proposal cannot then be approved',
      turns: [[MAP]],
      steps: [
        ['reject', 'map', 0],
        ['approve', 'map', 0],
      ],
      wantError: 'That proposal is no longer waiting for a decision.',
      wantCalls: [],
      want: [{ kind: 'map', status: 'rejected', ticketId: null }],
    },
  ];

  for (const item of cases) {
    const calls: string[] = [];
    const tracker = {
      write: async (_workspaceId: string, draft: { kind: string; title: string }) => {
        calls.push(`write ${draft.kind} ${draft.title}`);
        return { id: 'spec-ticket' };
      },
      change: async (ticketId: string, change: { gate?: string }) => {
        calls.push(`change ${ticketId} ${change.gate}`);
        return { id: ticketId };
      },
      approveDestinationSpec: async (_workspaceId: string, mapTicketId: string) => {
        calls.push(`destination ${mapTicketId}`);
        return { id: 'destination-ticket' };
      },
      createMap: async (_workspaceId: string, map: { title: string }) => {
        calls.push(`map ${map.title}`);
        return { id: 'map-ticket' };
      },
      approveDecision: async (_workspaceId: string, decision: { choice: string }) => {
        calls.push(`decision ${decision.choice}`);
        return { id: 'decision-record' };
      },
      approveOutcome: async (_workspaceId: string, ticketId: string) => {
        calls.push(`outcome ${ticketId}`);
        return { id: 'outcome-record' };
      },
      publishBreakdown: async (specTicketId: string, slices: unknown[]) => {
        calls.push(`publish ${specTicketId} ${slices.length}`);
        return { spec: { id: specTicketId }, children: [{ id: 'child-a' }] };
      },
      markBreakdownReady: async (specTicketId: string) => {
        calls.push(`ready ${specTicketId}`);
        if (item.refuseReadiness) throw new Error(READY_REFUSAL);
        return { spec: { id: specTicketId }, children: [{ id: 'child-a' }] };
      },
    } as unknown as Tracker;
    const session = await shapingChat(
      item.turns.flatMap((calls) => [...calls, { say: 'Waiting for you.' }]),
      tracker,
    );

    try {
      for (const _turn of item.turns) await session.chats.send('Propose it.');
      let error: string | undefined;
      for (const [action, kind, index] of item.steps) {
        const proposal = session.chats
          .state()
          .shaping?.proposals.filter((each) => each.kind === kind)[index];
        assert.ok(proposal, `${item.name}: no ${kind} ${index}`);
        try {
          if (action === 'approve') await session.chats.approveProposal(proposal.id);
          else await session.chats.rejectProposal(proposal.id);
        } catch (failure) {
          error = (failure as Error).message;
        }
      }

      assert.equal(error, item.wantError, item.name);
      assert.deepEqual(calls, item.wantCalls, item.name);
      assert.deepEqual(
        session.chats.state().shaping?.proposals.map(outcomeOf),
        item.want,
        item.name,
      );
    } finally {
      await session.close();
    }
  }
});
