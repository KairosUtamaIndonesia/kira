import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import { ThreadStore } from '../db/threads.ts';
import { tempDir } from '../test-support/temp.ts';
import { resumeConversation } from './conversations.ts';
import { subagentTool } from './extension/subagentTool.ts';
import { kiraModels, type Models } from './models.ts';
import { createThread } from './storage.ts';
import type { SubagentManager } from './subagents.ts';

// Hermetic, as the other booting tests are: pi reads `PI_CODING_AGENT_DIR` for
// settings and credentials and `HOME` for the global skills source.
process.env['HOME'] = tempDir('kira-subagent-wiring-home-');
process.env['PI_CODING_AGENT_DIR'] = tempDir('kira-subagent-wiring-agent-');

function models(): Models {
  const cache = join(tempDir('kira-subagent-wiring-models-'), 'models.json');
  writeFileSync(cache, JSON.stringify({ models: [{ id: 'served-model', name: 'Served Model' }] }));

  return kiraModels({
    server: 'http://localhost:4100',
    cachePath: cache,
    token: async () => 'device-key',
    catalog: async () => ({ kind: 'unavailable' }),
  });
}

test('the delegation tool hands the task to the manager and answers with the child', async () => {
  const spawned: { role: string; prompt: string }[] = [];
  const manager: SubagentManager = {
    spawn: (input) => {
      spawned.push({ role: input.role, prompt: input.prompt });
      return 'child-1';
    },
    list: () => [],
    activity: () => {},
    stop: async () => {},
    stopAll: async () => {},
    steer: async () => {},
    resume: async () => {},
    askParent: async () => null,
    settle: async () => {},
    subscribe: () => () => {},
    dispose: () => {},
  };

  const tool = subagentTool(manager);
  const result = await tool.execute(
    'call-1',
    { action: 'spawn', role: 'explore', task: 'Find the retry.' },
    undefined,
    undefined,
    {} as never,
  );

  assert.deepEqual(spawned, [{ role: 'explore', prompt: 'Find the retry.' }]);
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
  assert.match(text, /child-1/);
});

test('a child report in a chat reads as its own message, not Kira’s', async () => {
  const store = new ThreadStore(join(tempDir('kira-subagent-wiring-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-subagent-wiring-work-'));

  const report: Parameters<SessionManager['appendMessage']>[0] = {
    role: 'custom',
    customType: 'subagent-report',
    content: 'The retry lives in session.ts.',
    display: true,
    timestamp: 42,
  };
  thread.sessionManager.appendMessage(report);

  const conversation = await resumeConversation(store, thread.threadId, models());
  const said = conversation.transcript().messages.find((message) => message.role === 'subagent');

  assert.ok(said, 'the report is a message in the chat');
  assert.deepEqual(said.parts, [{ type: 'text', text: 'The retry lives in session.ts.' }]);

  conversation.close();
  store.close();
});
