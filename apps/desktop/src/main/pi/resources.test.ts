import { strict as assert } from 'node:assert';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { build } from 'vite';
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
const FORBIDDEN_HOST_SPECIFIC_WORDS = /\bgh\b|github|labels?|\.scratch/i;
const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../');
// Keep this loader test independent from skills installed on the developer's machine.
process.env['HOME'] = mkdtempSync(join(tmpdir(), 'kira-resource-home-'));
process.env['PI_CODING_AGENT_DIR'] = mkdtempSync(join(tmpdir(), 'kira-resource-config-'));

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
  const workspace = await tempDir('kira-resource-workspace-');
  const agentDir = await tempDir('kira-resource-agent-');
  const resourcesPath = await tempDir('kira-resource-package-');
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
    assert.doesNotMatch(text, FORBIDDEN_HOST_SPECIFIC_WORDS, skill.filePath);
  }
});

test('a development resource path resolves to the checked-in bundle', () => {
  assert.equal(bundledSkillsPath({ isPackaged: false }), join(desktopRoot, 'resources', 'skills'));
});

test('compiled desktop skills load independently of the workspace', async (t) => {
  const app = await tempDir('kira-resource-compiled-');
  const outDir = join(app, 'out', 'main');
  const shippedSkills = join(app, 'resources', 'skills');
  await cp(join(desktopRoot, 'resources', 'skills'), shippedSkills, { recursive: true });
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: join(desktopRoot, 'src', 'main', 'pi', 'resources.ts'),
      outDir,
      rollupOptions: { output: { format: 'es', entryFileNames: 'index.mjs' } },
    },
  });
  const compiled = await import(pathToFileURL(join(outDir, 'index.mjs')).href);

  for (const workspaceSkill of [false, true]) {
    await t.test(workspaceSkill ? 'with a workspace skill' : 'in an empty workspace', async () => {
      const workspace = await tempDir('kira-resource-workspace-');
      const agentDir = await tempDir('kira-resource-agent-');
      if (workspaceSkill) await writeWorkspaceSkill(workspace);
      const skillsPath = compiled.bundledSkillsPath({ isPackaged: false });
      assert.equal(skillsPath, shippedSkills);

      const loader = new DefaultResourceLoader({
        cwd: workspace,
        agentDir,
        settingsManager: SettingsManager.create(workspace, agentDir, { projectTrusted: true }),
        additionalSkillPaths: [skillsPath],
      });
      await loader.reload();
      assert.deepEqual(
        loader
          .getSkills()
          .skills.map((skill) => skill.name)
          .sort(),
        [...EXPECTED_SKILLS, ...(workspaceSkill ? ['workspace-only'] : [])].sort(),
      );
      const implement = loader.getSkills().skills.find((skill) => skill.name === 'implement');
      assert.equal(implement?.filePath, join(shippedSkills, 'implement', 'SKILL.md'));
      assert.match(await readFile(implement!.filePath, 'utf8'), /name: implement/);
    });
  }
});
