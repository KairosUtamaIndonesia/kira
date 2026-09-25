import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProjectSummary, WorkspaceSummary } from '../../preload/bridge.ts';
import { destinationForProject, projectWorkspaces } from './workNavigation.ts';

const project: ProjectSummary = { id: 'project-1', name: 'Foundry', prefix: 'FND' };
const workspace = (id: string, projectId: string | null): WorkspaceSummary => ({
  id,
  name: id,
  folder: `/work/${id}`,
  projectId,
});

test('finds only workspaces linked to the chosen project', () => {
  const cases = [
    {
      name: 'no local workspace',
      workspaces: [workspace('unlinked', null), workspace('other-project', 'project-2')],
      want: [],
    },
    {
      name: 'one local workspace',
      workspaces: [workspace('one', 'project-1'), workspace('other', 'project-2')],
      want: ['one'],
    },
    {
      name: 'several local workspaces',
      workspaces: [workspace('one', 'project-1'), workspace('two', 'project-1')],
      want: ['one', 'two'],
    },
  ];

  for (const testCase of cases) {
    assert.deepEqual(
      projectWorkspaces(project, testCase.workspaces).map((each) => each.id),
      testCase.want,
      testCase.name,
    );
  }
});

test('chooses the correct project opening step', () => {
  const cases = [
    {
      name: 'link a workspace when none is local',
      workspaces: [workspace('unlinked', null), workspace('other', 'project-2')],
      want: { kind: 'link' },
    },
    {
      name: 'open the only linked workspace',
      workspaces: [workspace('one', 'project-1')],
      want: { kind: 'open', workspace: workspace('one', 'project-1') },
    },
    {
      name: 'ask which linked workspace to open',
      workspaces: [workspace('one', 'project-1'), workspace('two', 'project-1')],
      want: {
        kind: 'choose',
        workspaces: [workspace('one', 'project-1'), workspace('two', 'project-1')],
      },
    },
  ];

  for (const testCase of cases) {
    assert.deepEqual(
      destinationForProject(project, testCase.workspaces),
      testCase.want,
      testCase.name,
    );
  }
});
