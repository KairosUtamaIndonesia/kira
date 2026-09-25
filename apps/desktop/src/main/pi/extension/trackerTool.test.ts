import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { GlossaryEntry, Ticket, TicketQueue } from '../../../preload/bridge.ts';
import { ThreadStore } from '../../db/threads.ts';
import { createThread } from '../storage.ts';
import {
  breakdownProposalTool,
  decisionProposalTool,
  mapProposalTool,
  outcomeProposalTool,
  specProposalTool,
  trackerTools,
} from './trackerTool.ts';

const ticket = (gate: Ticket['gate']): Ticket => ({
  id: 'ticket-1',
  projectId: 'project-1',
  name: 'FND-1',
  number: 1,
  kind: 'feature',
  title: 'A ticket',
  body: 'A draft',
  criteria: ['It is testable'],
  gate,
  band: gate === 'draft' ? 'draft' : 'ready',
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
});

test('tracker tools expose reads and draft-only writes without publication controls', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'kira-tracker-tool-store-')), 'threads.db');
  const store = new ThreadStore(path);
  const workspace = store.rememberWorkspace(
    mkdtempSync(join(tmpdir(), 'kira-tracker-tool-space-')),
  );
  const current = ticket('draft');
  // Use a real thread record so workspace resolution is exercised at the same
  // boundary as an actual session.
  const threadRecord = createThread(store, workspace.folder, { workspaceId: workspace.id });
  const glossary: GlossaryEntry = {
    id: 'term-1',
    projectId: workspace.id,
    term: 'ticket',
    meaning: 'a bounded unit of work',
    wordsToAvoid: [],
    version: 1,
    author: null,
    chatId: threadRecord?.threadId ?? '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    history: [],
  };
  const calls: string[] = [];
  const tracker = {
    queue: async (workspaceId: string) => {
      calls.push(`queue:${workspaceId}`);
      return { tickets: [current] } as TicketQueue;
    },
    readTicket: async (ref: string) => {
      calls.push(`read:${ref}`);
      return current;
    },
    glossary: async () => [glossary],
    decisions: async () => [{ choice: 'Use the tracker' }],
    updateGlossary: async (workspaceId: string, edit: { term: string; chatId: string }) => {
      calls.push(`update:${workspaceId}:${edit.term}:${edit.chatId}`);
      return { ...glossary, term: edit.term, version: 2 };
    },
    write: async () => current,
    change: async (_id: string, change: { body?: string }) => ({
      ...current,
      body: change.body ?? current.body,
    }),
  };

  const tools = trackerTools(store, threadRecord.threadId, tracker as never);
  const names = tools.map((tool) => tool.name);
  assert.deepEqual(names, [
    'tracker_queue',
    'tracker_read_ticket',
    'tracker_read_glossary',
    'tracker_read_decisions',
    'tracker_update_glossary',
    'tracker_write_draft',
    'tracker_edit_draft',
  ]);
  assert.ok(!names.some((name) => /publish|ready|approve/i.test(name)));

  const result = await tools[0]!.execute('call-1', {}, undefined, undefined, {} as never);
  assert.deepEqual(result.content, [
    { type: 'text', text: JSON.stringify({ tickets: [current] }) },
  ]);
  const update = await tools[4]!.execute(
    'call-2',
    { term: 'ticket', meaning: 'A bounded unit', wordsToAvoid: [] },
    undefined,
    undefined,
    {} as never,
  );
  assert.deepEqual(update.details, {
    workspaceId: workspace.id,
    chatId: threadRecord.threadId,
    entryId: glossary.id,
    version: 2,
    term: 'ticket',
  });
  await tools[6]!.execute(
    'call-3',
    { ref: current.name, body: 'Updated' },
    undefined,
    undefined,
    {} as never,
  );
  assert.deepEqual(calls, [
    `queue:${workspace.id}`,
    `update:${workspace.id}:ticket:${threadRecord.threadId}`,
    `read:${current.name}`,
  ]);
  store.close();
});

test('Kira cannot create a ticket through the draft-writing tool', async () => {
  const store = new ThreadStore(
    join(mkdtempSync(join(tmpdir(), 'kira-tracker-tool-store-')), 'threads.db'),
  );
  const workspace = store.rememberWorkspace(
    mkdtempSync(join(tmpdir(), 'kira-tracker-tool-space-')),
  );
  const thread = createThread(store, workspace.folder, { workspaceId: workspace.id });
  let writes = 0;
  const tools = trackerTools(store, thread.threadId, {
    queue: async () => ({}) as TicketQueue,
    readTicket: async () => ticket('draft'),
    write: async () => {
      writes += 1;
      return ticket('draft');
    },
    change: async () => ticket('draft'),
  } as never);

  await assert.rejects(
    tools[5]!.execute(
      'call-create',
      { kind: 'spec', title: 'A spec', body: 'Build it', criteria: ['It works'] },
      undefined,
      undefined,
      {} as never,
    ),
    { message: 'Kira cannot create tracker tickets; a person must create them.' },
  );
  assert.equal(writes, 0);
  store.close();
});

test('each proposal tool shows an approval card and tells Kira to wait for the person', async () => {
  const cases = [
    {
      name: 'spec',
      tool: specProposalTool(),
      params: {
        problem: 'The queue hides agreed work.',
        solution: 'Show it.',
        stories: ['A story'],
      },
      kind: 'spec-proposal',
      want: { problem: 'The queue hides agreed work.', solution: 'Show it.', stories: ['A story'] },
    },
    {
      name: 'breakdown',
      tool: breakdownProposalTool(),
      params: {
        slices: [
          { id: 'a', kind: 'feature', title: 'A', body: 'a', criteria: ['a'], dependsOn: [] },
        ],
      },
      kind: 'breakdown-proposal',
      want: {
        slices: [
          { id: 'a', kind: 'feature', title: 'A', body: 'a', criteria: ['a'], dependsOn: [] },
        ],
      },
    },
    {
      name: 'Decision',
      tool: decisionProposalTool(),
      params: {
        context: 'Approval is durable.',
        choice: 'Keep it person-owned.',
        rejectedOptions: ['Let Kira publish.'],
        consequences: 'The person decides.',
      },
      kind: 'decision-proposal',
      want: {
        context: 'Approval is durable.',
        choice: 'Keep it person-owned.',
        rejectedOptions: ['Let Kira publish.'],
        consequences: 'The person decides.',
        supersedes: null,
      },
    },
    {
      name: 'Outcome with a suggested Decision',
      tool: outcomeProposalTool(),
      params: {
        ticketId: 'question-1',
        answer: 'Keep approval in the person path.',
        sources: ['https://example.com/rule'],
        decisionProposal: {
          context: 'The approval boundary is durable.',
          choice: 'Keep it in the person path.',
          rejectedOptions: ['Let Kira publish directly.'],
          consequences: 'The person remains the authority.',
          supersedes: null,
        },
      },
      kind: 'outcome-proposal',
      want: {
        ticketId: 'question-1',
        answer: 'Keep approval in the person path.',
        sources: ['https://example.com/rule'],
        decisionProposal: {
          context: 'The approval boundary is durable.',
          choice: 'Keep it in the person path.',
          rejectedOptions: ['Let Kira publish directly.'],
          consequences: 'The person remains the authority.',
          supersedes: null,
        },
      },
    },
    {
      name: 'Outcome alone',
      tool: outcomeProposalTool(),
      params: { ticketId: 'question-1', answer: 'Yes.', sources: ['https://example.com'] },
      kind: 'outcome-proposal',
      want: {
        ticketId: 'question-1',
        answer: 'Yes.',
        sources: ['https://example.com'],
        decisionProposal: null,
      },
    },
    {
      name: 'map',
      tool: mapProposalTool(),
      params: { title: 'Overhaul', body: 'Big.', criteria: ['c'], questions: [], research: [] },
      kind: 'map-proposal',
      want: { title: 'Overhaul', body: 'Big.', criteria: ['c'], questions: [], research: [] },
    },
  ];

  for (const item of cases) {
    const result = await item.tool.execute(
      'call-1',
      item.params,
      undefined,
      undefined,
      {} as never,
    );
    const text = result.content.find((part) => part.type === 'text');
    assert.ok(text && text.type === 'text', item.name);
    assert.match(text.text, /approval card/, item.name);
    assert.match(text.text, /Wait for the person/, item.name);
    const details = result.details as unknown as { kind: string; proposal: { id: string } };
    assert.equal(details.kind, item.kind, item.name);
    const { id, ...proposal } = details.proposal;
    assert.equal(typeof id, 'string', item.name);
    assert.deepEqual(proposal, item.want, item.name);
  }
});

test('breakdown proposals reject invalid kinds and dependencies before a card is shown', async () => {
  const cases = [
    {
      name: 'unsupported kind',
      slices: [
        { id: 'a', kind: 'implementation', title: 'A', body: 'a', criteria: ['c'], dependsOn: [] },
      ],
      message:
        'Slice "a" has unsupported kind "implementation". Use one of: prototype, bug, feature, refactor, question, research, spec, map.',
    },
    {
      name: 'dependency is not a sibling slice',
      slices: [
        {
          id: 'a',
          kind: 'feature',
          title: 'A',
          body: 'a',
          criteria: ['c'],
          dependsOn: ['TESTPR-1'],
        },
      ],
      message:
        'Slice "a" depends on "TESTPR-1", which is not a sibling slice id. The approved spec gate is attached automatically.',
    },
  ];

  for (const item of cases) {
    await assert.rejects(
      breakdownProposalTool().execute(
        'call-invalid',
        { slices: item.slices },
        undefined,
        undefined,
        {} as never,
      ),
      { message: item.message },
      item.name,
    );
  }
});

test('editing a non-draft ticket is refused before the change seam is called', async () => {
  const store = new ThreadStore(
    join(mkdtempSync(join(tmpdir(), 'kira-tracker-tool-store-')), 'threads.db'),
  );
  const workspace = store.rememberWorkspace(
    mkdtempSync(join(tmpdir(), 'kira-tracker-tool-space-')),
  );
  const thread = createThread(store, workspace.folder, { workspaceId: workspace.id });
  const calls: string[] = [];
  const current = ticket('ready-for-agent');
  const tools = trackerTools(store, thread.threadId, {
    queue: async () => ({}) as TicketQueue,
    readTicket: async () => {
      calls.push('read');
      return current;
    },
    write: async () => current,
    change: async () => {
      calls.push('change');
      return current;
    },
  } as never);

  await assert.rejects(
    tools[6]!.execute(
      'call-1',
      { ref: current.name, body: 'No' },
      undefined,
      undefined,
      {} as never,
    ),
    { message: 'Kira can only edit draft tickets.' },
  );
  assert.deepEqual(calls, ['read']);
  store.close();
});
