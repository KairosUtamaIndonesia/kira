import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CONFIG_DIR_NAME,
  DefaultResourceLoader,
  getAgentDir,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { tempDir } from '../test-support/temp.ts';

/**
 * `scripts/patch-pi-config-dir.mjs` sets `piConfig.configDir` in pi's own
 * package.json to ".kira", run from `postinstall`. That single value drives
 * both the global agent directory and every workspace-local resource, so losing
 * it — most likely by upgrading pi — silently moves the app back to ".pi".
 * User skills and settings would simply stop being found, with nothing
 * reported. These tests are the alarm for that.
 *
 * The second thing they pin is pi's workspace-trust gate: workspace-local skills
 * are ignored unless the settings manager is told the workspace is trusted.
 * Kira has to opt in deliberately (see ADR 0002).
 */

// pi discovers skills from a hardcoded `~/.agents/skills` in package-manager.js,
// which reads process.env.HOME. Without this the skill list depends on whatever
// the developer happens to have in their home directory.
const home = tempDir('kira-home-');
process.env['HOME'] = home;

const CASES = [
  { name: 'trusted workspace', projectTrusted: true, wantProjectSkills: ['kira-skill'] },
  { name: 'untrusted workspace', projectTrusted: false, wantProjectSkills: [] },
];

function writeSkill(skillsDir: string, name: string): void {
  const dir = join(skillsDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: A skill that exists only in this test.\n---\n\nBody.\n`,
  );
}

test('pi resolves its config directory to .kira', () => {
  assert.equal(CONFIG_DIR_NAME, '.kira');
  assert.equal(getAgentDir(), join(home, '.kira', 'agent'));
});

for (const testCase of CASES) {
  test(`${testCase.name}: workspace skills come from .kira, never .pi`, async () => {
    const workspace = tempDir('kira-workspace-');
    const agentDir = tempDir('kira-agent-');

    // The same skill in both conventions: only .kira may win.
    writeSkill(join(workspace, '.kira', 'skills'), 'kira-skill');
    writeSkill(join(workspace, '.pi', 'skills'), 'pi-skill');

    const settingsManager = SettingsManager.create(workspace, agentDir, {
      projectTrusted: testCase.projectTrusted,
    });
    const loader = new DefaultResourceLoader({ cwd: workspace, agentDir, settingsManager });
    // The loader scans nothing until reload(); the constructor only records options.
    await loader.reload();

    const names = loader
      .getSkills()
      .skills.map((skill) => skill.name)
      .sort();

    assert.deepEqual(names, testCase.wantProjectSkills);
  });
}
