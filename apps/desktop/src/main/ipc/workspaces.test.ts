import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ProjectSummary, WorkspaceSummary } from '../../preload/bridge.ts';
import { type WorkspaceDeps, type WorkspaceHandlers, workspaceHandlers } from './workspaces.ts';

/**
 * A workspace is a folder, and the folder is chosen by hand — which is why the
 * chooser is a dependency here rather than a call from inside: the case that
 * matters most is the one where the picker is closed without choosing, and that
 * has to be reachable without opening a picker.
 *
 * The two server-backed calls are handed in for the same reason: what a refusal
 * says is decided in the main process, and what these handlers add is the check
 * that the window sent something a server could be asked.
 */
interface Case {
  name: string;
  makeDeps: (calls: string[]) => WorkspaceDeps;
  call: keyof WorkspaceHandlers;
  args?: unknown[];
  want: unknown;
  wantCalls: string[];
}

const added: WorkspaceSummary = {
  id: 'api',
  name: 'api',
  folder: '/work/api',
  projectId: null,
};

const joined: WorkspaceSummary = { ...added, projectId: 'kira-project' };

const projects: ProjectSummary[] = [{ id: 'kira-project', name: 'Kira', prefix: 'FND' }];

/** Deps that record what they were asked to do; `overrides` replace one of them. */
function deps(calls: string[], overrides: Partial<WorkspaceDeps> = {}): WorkspaceDeps {
  return {
    chooseFolder: async () => '/work/api',
    remember: (folder) => {
      calls.push(`remember ${folder}`);
      return added;
    },
    forget: async (id) => {
      calls.push(`forget ${id}`);
    },
    projects: async () => {
      calls.push('projects');
      return projects;
    },
    join: async (workspaceId, request) => {
      calls.push(`join ${workspaceId} ${JSON.stringify(request)}`);
      return joined;
    },
    ...overrides,
  };
}

const CASES: Case[] = [
  {
    name: 'add remembers the folder that was chosen',
    makeDeps: (calls) => deps(calls),
    call: 'add',
    want: { ok: true, value: added },
    wantCalls: ['remember /work/api'],
  },
  {
    name: 'add answers nothing when the picker is closed without choosing',
    makeDeps: (calls) =>
      deps(calls, {
        chooseFolder: async () => null,
        remember: () => assert.fail('a workspace was remembered'),
      }),
    call: 'add',
    want: { ok: true, value: null },
    wantCalls: [],
  },
  {
    name: 'add reports a failure as a value',
    makeDeps: (calls) =>
      deps(calls, {
        chooseFolder: async () => {
          throw new Error('the picker could not be opened');
        },
      }),
    call: 'add',
    want: { ok: false, error: 'the picker could not be opened' },
    wantCalls: [],
  },
  {
    name: 'remove forgets the named workspace',
    makeDeps: (calls) => deps(calls),
    call: 'remove',
    args: ['api'],
    want: { ok: true, value: null },
    wantCalls: ['forget api'],
  },
  {
    name: 'remove reports a failure as a value',
    makeDeps: (calls) =>
      deps(calls, {
        forget: () => {
          throw new Error('the database is read-only');
        },
      }),
    call: 'remove',
    args: ['api'],
    want: { ok: false, error: 'the database is read-only' },
    wantCalls: [],
  },
  {
    name: 'remove refuses a workspace that is not named by an id',
    makeDeps: (calls) => deps(calls, { forget: () => assert.fail('a workspace was forgotten') }),
    call: 'remove',
    args: [undefined],
    want: { ok: false, error: 'A workspace needs an id to be removed.' },
    wantCalls: [],
  },
  {
    name: 'remove refuses a workspace named by nothing',
    makeDeps: (calls) => deps(calls, { forget: () => assert.fail('a workspace was forgotten') }),
    call: 'remove',
    args: [''],
    want: { ok: false, error: 'A workspace needs an id to be removed.' },
    wantCalls: [],
  },
  {
    name: 'projects answers the projects the server holds',
    makeDeps: (calls) => deps(calls),
    call: 'projects',
    want: { ok: true, value: projects },
    wantCalls: ['projects'],
  },
  {
    name: 'projects says why the server could not be asked rather than answering none',
    makeDeps: (calls) =>
      deps(calls, {
        projects: async () => {
          throw new Error('Kira could not be reached.');
        },
      }),
    call: 'projects',
    want: { ok: false, error: 'Kira could not be reached.' },
    wantCalls: [],
  },
  {
    name: 'join takes a project the server already holds',
    makeDeps: (calls) => deps(calls),
    call: 'join',
    args: ['api', { kind: 'existing', projectId: 'kira-project' }],
    want: { ok: true, value: joined },
    wantCalls: ['join api {"kind":"existing","projectId":"kira-project"}'],
  },
  {
    name: 'join takes a project being made, by name and prefix',
    makeDeps: (calls) => deps(calls),
    call: 'join',
    args: ['api', { kind: 'new', name: 'Kira', prefix: 'FND' }],
    want: { ok: true, value: joined },
    wantCalls: ['join api {"kind":"new","name":"Kira","prefix":"FND"}'],
  },
  {
    name: 'join says why the server would not take the project',
    makeDeps: (calls) =>
      deps(calls, {
        join: async () => {
          throw new Error('Another project already holds FND.');
        },
      }),
    call: 'join',
    args: ['api', { kind: 'new', name: 'Kira', prefix: 'FND' }],
    want: { ok: false, error: 'Another project already holds FND.' },
    wantCalls: [],
  },
  {
    name: 'join refuses a workspace that is not named by an id',
    makeDeps: (calls) => deps(calls, { join: async () => assert.fail('a join happened') }),
    call: 'join',
    args: ['', { kind: 'existing', projectId: 'kira-project' }],
    want: { ok: false, error: 'A workspace needs an id to be joined.' },
    wantCalls: [],
  },
  {
    name: 'join refuses a project that is not named',
    makeDeps: (calls) => deps(calls, { join: async () => assert.fail('a join happened') }),
    call: 'join',
    args: ['api', { kind: 'existing' }],
    want: { ok: false, error: 'That is not a project to join.' },
    wantCalls: [],
  },
  {
    name: 'join refuses a project being made with no name',
    makeDeps: (calls) => deps(calls, { join: async () => assert.fail('a join happened') }),
    call: 'join',
    args: ['api', { kind: 'new', name: '   ', prefix: 'FND' }],
    want: { ok: false, error: 'That is not a project to join.' },
    wantCalls: [],
  },
  {
    name: 'join refuses a project being made with no prefix',
    makeDeps: (calls) => deps(calls, { join: async () => assert.fail('a join happened') }),
    call: 'join',
    args: ['api', { kind: 'new', name: 'Kira' }],
    want: { ok: false, error: 'That is not a project to join.' },
    wantCalls: [],
  },
  {
    name: 'join refuses a request that is not a join at all',
    makeDeps: (calls) => deps(calls, { join: async () => assert.fail('a join happened') }),
    call: 'join',
    args: ['api', 'kira-project'],
    want: { ok: false, error: 'That is not a project to join.' },
    wantCalls: [],
  },
];

for (const testCase of CASES) {
  test(testCase.name, async () => {
    const calls: string[] = [];
    const handlers = workspaceHandlers(testCase.makeDeps(calls));
    const [first, second] = testCase.args ?? [];
    const run = {
      add: () => handlers.add(),
      remove: () => handlers.remove(first),
      projects: () => handlers.projects(),
      join: () => handlers.join(first, second),
    } as const;

    assert.deepEqual(await run[testCase.call](), testCase.want);
    assert.deepEqual(calls, testCase.wantCalls);
  });
}
