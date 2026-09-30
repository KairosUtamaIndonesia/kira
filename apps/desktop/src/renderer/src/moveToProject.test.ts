import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ProjectSummary, WorkspaceSummary } from '../../preload/bridge.ts';
import { needsProject, placesOf } from './moveToProject.ts';

const pomodoro: WorkspaceSummary = {
  id: 'w-pomodoro',
  name: 'pomodoro',
  folder: '/home/me/pomodoro',
  projectId: 'p-pomodoro',
};
const loose: WorkspaceSummary = {
  id: 'w-loose',
  name: 'loose',
  folder: '/home/me/loose',
  projectId: null,
};
const demo: WorkspaceSummary = {
  id: 'w-demo',
  name: 'demo',
  folder: '/home/me/demo',
  projectId: 'p-demo',
};

const projects: ProjectSummary[] = [
  { id: 'p-pomodoro', name: 'Pomodoro', prefix: 'POMO' },
  { id: 'p-demo', name: 'Demo', prefix: 'DEMO' },
];

const NEEDS_PROJECT: Array<{
  name: string;
  workspaceId: string | null;
  workspaces: WorkspaceSummary[];
  want: boolean;
}> = [
  { name: 'a chat filed nowhere', workspaceId: null, workspaces: [pomodoro], want: true },
  {
    name: 'a chat filed under a workspace that is gone',
    workspaceId: 'w-gone',
    workspaces: [pomodoro],
    want: true,
  },
  {
    name: 'a chat filed under a folder with no project',
    workspaceId: 'w-loose',
    workspaces: [loose],
    want: true,
  },
  {
    name: 'a chat filed under a folder in a project',
    workspaceId: 'w-pomodoro',
    workspaces: [pomodoro, loose],
    want: false,
  },
];

for (const testCase of NEEDS_PROJECT) {
  test(`needsProject: ${testCase.name}`, () => {
    assert.equal(needsProject(testCase.workspaceId, testCase.workspaces), testCase.want);
  });
}

const PLACES: Array<{
  name: string;
  workspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
  want: Array<{ workspace: string; project: string | undefined }>;
}> = [
  {
    name: 'keeps only folders that are in a project, in the order they are held',
    workspaces: [demo, loose, pomodoro],
    projects,
    want: [
      { workspace: 'w-demo', project: 'p-demo' },
      { workspace: 'w-pomodoro', project: 'p-pomodoro' },
    ],
  },
  {
    name: 'keeps a folder whose project the server did not list, with no project to name',
    workspaces: [pomodoro],
    projects: [],
    want: [{ workspace: 'w-pomodoro', project: undefined }],
  },
  {
    name: 'has nothing to offer when no folder is in a project',
    workspaces: [loose],
    projects,
    want: [],
  },
];

for (const testCase of PLACES) {
  test(`placesOf: ${testCase.name}`, () => {
    const got = placesOf(testCase.workspaces, testCase.projects).map((each) => ({
      workspace: each.workspace.id,
      project: each.project?.id,
    }));

    assert.deepEqual(got, testCase.want);
  });
}
