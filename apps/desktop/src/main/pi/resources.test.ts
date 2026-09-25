import { strict as assert } from 'node:assert';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { bundledSkillsPath } from './resources.ts';

const EXPECTED_SKILLS = [
  'diagnosing-bugs',
  'domain-modeling',
  'grilling',
  'implement',
  'merge-conflict',
  'prototype',
  'research',
  'router',
  'to-spec',
  'to-tickets',
  'wayfinder',
];
const FORBIDDEN_HOST_WORDS = /\bgh\b|github|labels?|\.scratch|pull request|\bPR\b/i;
const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../');
// Keep this loader test independent from skills installed on the developer's machine.
process.env['HOME'] = mkdtempSync(join(tmpdir(), 'foundry-resource-home-'));

function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeWorkspaceSkill(workspace: string): Promise<void> {
  const skills = join(workspace, '.agents', 'skills', 'workspace-only');
  await mkdir(skills, { recursive: true });
  await writeFile(
    join(skills, 'SKILL.md'),
    '---\nname: workspace-only\ndescription: A workspace skill.\n---\n\nWorkspace guidance.\n',
  );
}

test('the builder ships the resource directory outside the application bundle', async () => {
  const builder = await readFile(join(desktopRoot, 'electron-builder.yml'), 'utf8');

  assert.match(builder, /extraResources:/);
  assert.match(builder, /from: resources\/skills/);
  assert.match(builder, /to: skills/);
});

test('a packaged resource copy loads beside workspace .agents skills', async () => {
  const workspace = await tempDir('foundry-resource-workspace-');
  const agentDir = await tempDir('foundry-resource-agent-');
  const resourcesPath = await tempDir('foundry-resource-package-');
  const shippedSkills = join(resourcesPath, 'skills');
  const sourceSkills = bundledSkillsPath({ isPackaged: false });

  await cp(sourceSkills, shippedSkills, { recursive: true });
  await writeWorkspaceSkill(workspace);

  const settingsManager = SettingsManager.create(workspace, agentDir, { projectTrusted: true });
  const loader = new DefaultResourceLoader({
    cwd: workspace,
    agentDir,
    settingsManager,
    additionalSkillPaths: [bundledSkillsPath({ isPackaged: true, resourcesPath })],
  });
  await loader.reload();

  const names = loader
    .getSkills()
    .skills.map((skill) => skill.name)
    .sort();

  assert.deepEqual(names, [...EXPECTED_SKILLS, 'workspace-only'].sort());

  for (const skill of loader.getSkills().skills) {
    if (skill.name === 'workspace-only') continue;
    assert.equal(skill.filePath.startsWith(shippedSkills), true, skill.filePath);
    const text = await readFile(skill.filePath, 'utf8');
    assert.doesNotMatch(text, FORBIDDEN_HOST_WORDS, skill.filePath);
  }
});

test('a development resource path resolves to the checked-in bundle', () => {
  assert.equal(bundledSkillsPath({ isPackaged: false }), join(desktopRoot, 'resources', 'skills'));
});
