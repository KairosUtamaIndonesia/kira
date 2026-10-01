import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Check } from 'typebox/value';
import type { GlossaryEntry, Ticket, TicketQueue, TicketStatus } from '../../../preload/bridge.ts';
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

const ticket = (status: TicketStatus): Ticket => ({
  id: 'ticket-1',
  projectId: 'project-1',
  name: 'FND-1',
  number: 1,
  kind: 'feature',
  title: 'A ticket',
  body: 'A draft',
  criteria: ['It is testable'],
  status,
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
});

test('tracker tools expose ticket operations and person-owned publication controls', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'kira-tracker-tool-store-')), 'threads.db');
  const store = new ThreadStore(path);
  const workspace = store.rememberWorkspace(
    mkdtempSync(join(tmpdir(), 'kira-tracker-tool-space-')),
  );
  const current = ticket('draft');
  store.joinWorkspace(workspace.id, current.projectId);
  // Use a real thread record so workspace resolution is exercised at the same
  // boundary as an actual session.
  const threadRecord = createThread(store, workspace.folder, {
    workspaceId: workspace.id,
    workTicketIds: [current.id],
  });
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
    currentUserId: async () => 'ada',
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
    'tracker_create_ticket',
    'tracker_update_ticket',
    'tracker_comment',
    'tracker_read_timeline',
    'tracker_add_blocker',
    'tracker_remove_blocker',
  ]);
  assert.ok(!names.some((name) => /delete|publish|approve/i.test(name)));

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

test('creating a ticket links it to this chat and exposes no delete tool', async () => {
  const store = new ThreadStore(
    join(mkdtempSync(join(tmpdir(), 'kira-tracker-tool-store-')), 'threads.db'),
  );
  const workspace = store.rememberWorkspace(
    mkdtempSync(join(tmpdir(), 'kira-tracker-tool-space-')),
  );
  const thread = createThread(store, workspace.folder, { workspaceId: workspace.id });
  let writes = 0;
  const made = { ...ticket('draft'), id: 'created-ticket' };
  let written: unknown;
  const tools = trackerTools(store, thread.threadId, {
    queue: async () => ({}) as TicketQueue,
    readTicket: async () => ticket('draft'),
    currentUserId: async () => 'ada',
    write: async (_workspaceId: string, draft: unknown) => {
      writes += 1;
      written = draft;
      return made;
    },
    change: async () => ticket('draft'),
  } as never);

  const answer = await tools[5]!.execute(
    'call-create',
    { kind: 'spec', title: 'A spec', body: 'Build it', criteria: ['It works'] },
    undefined,
    undefined,
    {} as never,
  );
  const first = answer.content[0];
  assert.ok(first?.type === 'text');
  assert.deepEqual(JSON.parse(first.text), made);
  assert.equal(writes, 1);
  assert.deepEqual(written, {
    kind: 'spec',
    title: 'A spec',
    body: 'Build it',
    criteria: ['It works'],
    status: 'draft',
  });
  assert.deepEqual(store.getThread(thread.threadId).workTicketIds, [made.id]);
  assert.ok(!tools.some((tool) => tool.name.includes('delete')));
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

test('ticket tools use the current project, not attachments, as their boundary', async (t) => {
  const actions = [
    { name: 'read', tool: 'tracker_read_ticket', edit: {}, writes: 0 },
    { name: 'rename', tool: 'tracker_update_ticket', edit: { title: 'Renamed' }, writes: 1 },
    { name: 'start work', tool: 'tracker_update_ticket', edit: { status: 'running' }, writes: 1 },
    { name: 'add blocker', tool: 'tracker_add_blocker', edit: { blockedBy: 'FND-2' }, writes: 1 },
    {
      name: 'remove blocker',
      tool: 'tracker_remove_blocker',
      edit: { blockedBy: 'FND-2' },
      writes: 1,
    },
  ];
  const scopes = [
    { name: 'same project, unattached', projectId: 'project-1', linked: false },
    { name: 'same project, attached', projectId: 'project-1', linked: true },
    { name: 'another project', projectId: 'project-2', linked: false },
    { name: 'another project, attached', projectId: 'project-2', linked: true },
    {
      name: 'blocker from another project',
      projectId: 'project-1',
      linked: false,
      foreignBlocker: true,
    },
    { name: 'workspace without a project', projectId: null, linked: true },
    { name: 'chat without a workspace', projectId: 'project-1', linked: true, noWorkspace: true },
  ];

  for (const scope of scopes) {
    for (const action of actions) {
      await t.test(`${scope.name}: ${action.name}`, async (t) => {
        const store = new ThreadStore(
          join(mkdtempSync(join(tmpdir(), 'kira-tracker-tool-store-')), 'threads.db'),
        );
        t.after(() => store.close());
        const workspace = store.rememberWorkspace(
          mkdtempSync(join(tmpdir(), 'kira-tracker-tool-space-')),
        );
        if (scope.projectId !== null) store.joinWorkspace(workspace.id, scope.projectId);
        const current = ticket('ready');
        const blocker = {
          ...current,
          id: 'ticket-2',
          name: 'FND-2',
          projectId: scope.foreignBlocker ? 'project-2' : current.projectId,
        };
        const before = scope.linked ? [current.id] : ['spec-1'];
        const thread = createThread(store, workspace.folder, {
          workspaceId: scope.noWorkspace ? undefined : workspace.id,
          workTicketIds: before,
          attachedTicketIds: scope.linked ? [current.id] : [],
        });
        let writes = 0;
        const write = async () => {
          writes += 1;
          return current;
        };
        const tools = trackerTools(store, thread.threadId, {
          readTicket: async (ref: string) => (ref === blocker.name ? blocker : current),
          currentUserId: async () => 'ada',
          change: write,
          gate: write,
          ungate: write,
        } as never);
        const tool = tools.find((tool) => tool.name === action.tool)!;
        const call = () =>
          tool.execute(
            'call-project',
            { ref: current.name, ...action.edit },
            undefined,
            undefined,
            {} as never,
          );
        const error = scope.noWorkspace
          ? 'This chat is not filed in a project workspace.'
          : scope.projectId === null
            ? 'This folder is not working a project yet.'
            : scope.projectId !== current.projectId ||
                (scope.foreignBlocker && action.edit.blockedBy !== undefined)
              ? 'This chat can only access tickets in its current project.'
              : null;
        const attachments = store.getThread(thread.threadId).attachedTicketIds;
        if (error !== null) {
          await assert.rejects(call, { message: error });
          assert.equal(writes, 0);
          assert.deepEqual(store.getThread(thread.threadId).workTicketIds, before);
        } else {
          await call();
          assert.equal(writes, action.writes);
          const after =
            action.name === 'start work' && !scope.linked ? [...before, current.id] : before;
          assert.deepEqual(store.getThread(thread.threadId).workTicketIds, after);
          if (action.name === 'start work') {
            await call();
            assert.deepEqual(store.getThread(thread.threadId).workTicketIds, after);
          }
        }
        assert.deepEqual(store.getThread(thread.threadId).attachedTicketIds, attachments);
      });
    }
  }
});

test('a refused Running update leaves the chat link unchanged', async (t) => {
  const store = new ThreadStore(
    join(mkdtempSync(join(tmpdir(), 'kira-tracker-tool-store-')), 'threads.db'),
  );
  t.after(() => store.close());
  const workspace = store.rememberWorkspace(
    mkdtempSync(join(tmpdir(), 'kira-tracker-tool-space-')),
  );
  const current = ticket('ready');
  store.joinWorkspace(workspace.id, current.projectId);
  const thread = createThread(store, workspace.folder, {
    workspaceId: workspace.id,
    workTicketIds: ['spec-1'],
  });
  const tools = trackerTools(store, thread.threadId, {
    readTicket: async () => current,
    currentUserId: async () => 'ada',
    change: async () => {
      throw new Error('Kira could not be reached.');
    },
  } as never);
  await assert.rejects(
    tools
      .find((tool) => tool.name === 'tracker_update_ticket')!
      .execute(
        'call-running',
        { ref: current.name, status: 'running' },
        undefined,
        undefined,
        {} as never,
      ),
    { message: 'Kira could not be reached.' },
  );
  assert.deepEqual(store.getThread(thread.threadId).workTicketIds, ['spec-1']);
});

test('project ticket status updates allow only Running and Needs review', async () => {
  interface StatusCase {
    edit: Record<string, unknown>;
    status: string;
    remote?: boolean;
    currentStatus?: TicketStatus;
    currentPullRequestUrl?: string;
    allowed: boolean;
    schemaValid: boolean;
    change?: Record<string, unknown>;
    error?: string;
  }

  const cases: StatusCase[] = [
    {
      edit: { status: 'running' },
      status: 'running',
      allowed: true,
      schemaValid: true,
      change: { status: 'running', assigneeId: 'ada' },
    },
    {
      edit: { status: 'needs-review' },
      status: 'needs-review',
      remote: false,
      allowed: true,
      schemaValid: true,
      change: { status: 'needs-review' },
    },
    {
      edit: { status: 'needs-review', pullRequestUrl: 'https://github.com/example/kira/pull/42' },
      status: 'needs-review with a pull request',
      remote: true,
      allowed: true,
      schemaValid: true,
      change: {
        status: 'needs-review',
        pullRequestUrl: 'https://github.com/example/kira/pull/42',
      },
    },
    {
      edit: { status: 'needs-review', pullRequestUrl: null },
      status: 'needs-review without a pull request',
      remote: false,
      allowed: true,
      schemaValid: true,
      change: { status: 'needs-review', pullRequestUrl: null },
    },
    {
      edit: { status: 'needs-review' },
      status: 'needs-review requires a pull request when a remote exists',
      remote: true,
      currentStatus: 'running',
      allowed: false,
      schemaValid: true,
      error:
        'With a remote, Needs review requires a pull request URL. Leave or set the ticket to Running until the URL is available, and report any blocker.',
    },
    {
      edit: { status: 'needs-review', pullRequestUrl: null },
      status: 'needs-review cannot clear its only pull request link',
      remote: true,
      currentStatus: 'running',
      currentPullRequestUrl: 'https://github.com/example/kira/pull/42',
      allowed: false,
      schemaValid: true,
      error:
        'With a remote, Needs review requires a pull request URL. Leave or set the ticket to Running until the URL is available, and report any blocker.',
    },
    {
      edit: { pullRequestUrl: null },
      status: 'clearing a review link with a remote returns the ticket to Running',
      remote: true,
      currentStatus: 'needs-review',
      currentPullRequestUrl: 'https://github.com/example/kira/pull/42',
      allowed: true,
      schemaValid: true,
      change: { pullRequestUrl: null, status: 'running', assigneeId: 'ada' },
    },
    {
      edit: { pullRequestUrl: null },
      status: 'clearing a review link with unknown remote state returns the ticket to Running',
      currentStatus: 'needs-review',
      currentPullRequestUrl: 'https://github.com/example/kira/pull/42',
      allowed: true,
      schemaValid: true,
      change: { pullRequestUrl: null, status: 'running', assigneeId: 'ada' },
    },
    {
      edit: { status: 'running', pullRequestUrl: null },
      status: 'a cleared review link returns the ticket to Running',
      remote: true,
      currentStatus: 'needs-review',
      currentPullRequestUrl: 'https://github.com/example/kira/pull/42',
      allowed: true,
      schemaValid: true,
      change: { status: 'running', pullRequestUrl: null, assigneeId: 'ada' },
    },
    {
      edit: { status: 'needs-review' },
      status: 'needs-review fails closed when Git cannot answer',
      currentStatus: 'running',
      allowed: false,
      schemaValid: true,
      error:
        'Could not determine whether this checkout has a remote. Leave the ticket Running and report the blocker.',
    },
    {
      edit: { status: 'needs-review' },
      status: 'needs-review accepts an existing pull request when a remote exists',
      remote: true,
      currentStatus: 'running',
      currentPullRequestUrl: 'https://github.com/example/kira/pull/42',
      allowed: true,
      schemaValid: true,
      change: { status: 'needs-review' },
    },
    {
      edit: { status: 'Needs review' },
      status: 'Needs review',
      allowed: false,
      schemaValid: false,
    },
    { edit: { status: 'draft' }, status: 'draft', allowed: false, schemaValid: false },
    { edit: { status: 'ready' }, status: 'ready', allowed: false, schemaValid: false },
    { edit: { status: 'done' }, status: 'done', allowed: false, schemaValid: false },
    { edit: { status: 'wont-do' }, status: 'wont-do', allowed: false, schemaValid: false },
    { edit: { status: 'blocked' }, status: 'blocked', allowed: false, schemaValid: false },
  ];

  for (const item of cases) {
    test(item.status, async () => {
      const store = new ThreadStore(
        join(mkdtempSync(join(tmpdir(), 'kira-tracker-tool-store-')), 'threads.db'),
      );
      const workspace = store.rememberWorkspace(
        mkdtempSync(join(tmpdir(), 'kira-tracker-tool-space-')),
      );
      const current = {
        ...ticket(item.currentStatus ?? 'ready'),
        pullRequestUrl: item.currentPullRequestUrl ?? null,
      };
      store.joinWorkspace(workspace.id, current.projectId);
      const thread = createThread(store, workspace.folder, {
        workspaceId: workspace.id,
      });
      const changes: unknown[] = [];
      const tools = trackerTools(store, thread.threadId, {
        queue: async () => ({}) as TicketQueue,
        readTicket: async () => current,
        checkoutHasRemote: async (folder: string) => {
          assert.equal(folder, workspace.folder);
          return item.remote ?? null;
        },
        currentUserId: async () => 'ada',
        change: async (_id: string, change: unknown) => {
          changes.push(change);
          return current;
        },
      } as never);

      const parameters = { ref: current.name, ...item.edit };
      assert.equal(Check(tools[6]!.parameters, parameters), item.schemaValid, item.status);

      const call = () =>
        tools[6]!.execute('call-status', parameters, undefined, undefined, {} as never);

      if (item.allowed) {
        await call();
        assert.deepEqual(changes, [item.change], item.status);
        assert.deepEqual(
          store.getThread(thread.threadId).workTicketIds,
          item.change?.status === 'running' ? [current.id] : [],
          item.status,
        );
      } else {
        await assert.rejects(call, {
          message: item.error ?? 'The agent can set only Running or Needs review.',
        });
        assert.deepEqual(changes, [], item.status);
        assert.deepEqual(store.getThread(thread.threadId).workTicketIds, [], item.status);
      }
      store.close();
    });
  }
});
