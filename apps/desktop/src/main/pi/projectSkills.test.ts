import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { tempDir } from '../test-support/temp.ts';
import {
  materializeProjectSkills,
  projectSkillsPath,
  type ProjectSkill,
} from './projectSkills.ts';

// pi discovers skills from a hardcoded `~/.agents/skills` that reads HOME, so a
// developer's own skills would otherwise decide what these tests see.
process.env['HOME'] = tempDir('kira-project-skills-home-');

const REVIEW: ProjectSkill = {
  id: 'skill-1',
  projectId: 'project-1',
  name: 'review-checklist',
  description: 'What every review must check before a change lands.',
  body: '# Review checklist\n\nRead the change, then read the tests.\n',
  files: [],
  author: null,
  createdAt: '2026-10-02T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
};

/** A folder with no project skills, and pi's loader pointed at Kira's directory. */
async function loaderFor(workspace: string, skillsPath: string | null) {
  const agentDir = tempDir('kira-project-skills-agent-');
  const loader = new DefaultResourceLoader({
    cwd: workspace,
    agentDir,
    settingsManager: SettingsManager.create(workspace, agentDir, {
      projectTrusted: false,
    }),
    ...(skillsPath === null ? {} : { additionalSkillPaths: [skillsPath] }),
  });
  await loader.reload();
  return loader;
}

test('a skill is written as its own SKILL.md', () => {
  const workspace = tempDir('kira-project-skills-workspace-');

  const root = materializeProjectSkills(workspace, [REVIEW]);

  assert.equal(root, projectSkillsPath(workspace));
  const written = readFileSync(join(root!, REVIEW.name, 'SKILL.md'), 'utf8');
  assert.match(written, /^---\nname: review-checklist\n/);
  assert.match(written, /Read the change, then read the tests\./);
});

test('a skill writes the files that travel with it, nested directories and all', () => {
  const workspace = tempDir('kira-project-skills-workspace-');

  const root = materializeProjectSkills(workspace, [
    {
      ...REVIEW,
      files: [
        { path: 'checklist.md', content: 'Check.' },
        { path: 'templates/report.md', content: 'Report.' },
      ],
    },
  ]);

  assert.equal(readFileSync(join(root!, REVIEW.name, 'checklist.md'), 'utf8'), 'Check.');
  assert.equal(
    readFileSync(join(root!, REVIEW.name, 'templates', 'report.md'), 'utf8'),
    'Report.',
  );
});

test('a skill the project no longer has stops being written', () => {
  const workspace = tempDir('kira-project-skills-workspace-');
  const root = materializeProjectSkills(workspace, [REVIEW, { ...REVIEW, name: 'style-check' }]);

  materializeProjectSkills(workspace, [REVIEW]);

  assert.equal(existsSync(join(root!, 'style-check')), false);
  assert.equal(existsSync(join(root!, REVIEW.name, 'SKILL.md')), true);
});

test('a file a skill no longer has stops being written', () => {
  const workspace = tempDir('kira-project-skills-workspace-');
  const root = materializeProjectSkills(workspace, [
    { ...REVIEW, files: [{ path: 'checklist.md', content: 'Check.' }] },
  ]);

  materializeProjectSkills(workspace, [REVIEW]);

  assert.equal(existsSync(join(root!, REVIEW.name, 'checklist.md')), false);
});

test('a project with no skills is written as no directory at all', () => {
  const workspace = tempDir('kira-project-skills-workspace-');
  const root = projectSkillsPath(workspace);
  materializeProjectSkills(workspace, [REVIEW]);

  assert.equal(materializeProjectSkills(workspace, []), null);
  // A path handed to pi that does not exist is an error diagnostic in every
  // session afterwards, so the directory goes rather than standing empty.
  assert.equal(existsSync(root), false);
});

test('a file that would land outside its skill is refused', () => {
  const workspace = tempDir('kira-project-skills-workspace-');

  assert.throws(
    () =>
      materializeProjectSkills(workspace, [
        { ...REVIEW, files: [{ path: '../escape.md', content: 'Out.' }] },
      ]),
    /outside its directory/,
  );
});

test('pi loads a materialized skill in a folder it does not trust', async () => {
  const workspace = tempDir('kira-project-skills-workspace-');
  const root = materializeProjectSkills(workspace, [REVIEW]);

  const skills = (await loaderFor(workspace, root)).getSkills().skills;

  assert.deepEqual(
    skills.map((skill) => skill.name),
    ['review-checklist'],
  );
  assert.equal(skills[0]?.description, REVIEW.description);
});

test('a description keeps its meaning through the frontmatter', async () => {
  const workspace = tempDir('kira-project-skills-workspace-');
  const description = 'Check "every" change: no exceptions, and no \'maybe\'.';
  const root = materializeProjectSkills(workspace, [{ ...REVIEW, description }]);

  const skills = (await loaderFor(workspace, root)).getSkills().skills;

  assert.equal(skills[0]?.description, description);
});

test('a description written over several lines still parses as one', async () => {
  const workspace = tempDir('kira-project-skills-workspace-');
  const root = materializeProjectSkills(workspace, [
    { ...REVIEW, description: 'Check every change.\nThen check the tests.' },
  ]);

  const skills = (await loaderFor(workspace, root)).getSkills().skills;

  assert.equal(skills[0]?.description, 'Check every change. Then check the tests.');
});

test('a folder with no project skills offers pi none', async () => {
  const workspace = tempDir('kira-project-skills-workspace-');

  const skills = (await loaderFor(workspace, null)).getSkills().skills;

  assert.deepEqual(skills, []);
});
