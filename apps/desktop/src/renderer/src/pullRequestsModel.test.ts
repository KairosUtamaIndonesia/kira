import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { LivePullRequest } from '../../preload/bridge.ts';
import { checksWord, rowLabel, stateWord, visibleRequests } from './pullRequestsModel.ts';

test('a pull request state is said in a person’s words', () => {
  assert.equal(stateWord('open'), 'Open');
  assert.equal(stateWord('draft'), 'Draft');
  assert.equal(stateWord('merged'), 'Merged');
  assert.equal(stateWord('closed'), 'Closed');
  assert.equal(stateWord('queued'), 'queued');
});

test('a checks rollup is said in a person’s words, or not at all', () => {
  assert.equal(checksWord('passed'), 'Checks passed');
  assert.equal(checksWord('failed'), 'Checks failed');
  assert.equal(checksWord('pending'), 'Checks running');
  assert.equal(checksWord('neutral'), 'Checks neutral');
  assert.equal(checksWord(null), null);
});

test('a row is its number then its title', () => {
  assert.equal(rowLabel(12, 'Fix the thing'), '#12 Fix the thing');
});

function request(values: Partial<LivePullRequest> = {}): LivePullRequest {
  return {
    number: 1,
    title: 'A change',
    state: 'open',
    url: 'https://example.test/pull/1',
    branch: 'topic',
    authorLogin: 'ada',
    checksState: null,
    updatedAt: null,
    ...values,
  };
}

test('a search matches number, title, author and branch', () => {
  const held = [
    request({ number: 165, title: 'chore: add dummy PR note', branch: 'agent/dummy-pr' }),
    request({ number: 121, title: 'feat: execution loop', authorLogin: 'grace' }),
  ];
  assert.deepEqual(
    visibleRequests(held, 'dummy').map((each) => each.number),
    [165],
  );
  assert.deepEqual(
    visibleRequests(held, '#121').map((each) => each.number),
    [121],
  );
  assert.deepEqual(
    visibleRequests(held, 'grace').map((each) => each.number),
    [121],
  );
  assert.deepEqual(
    visibleRequests(held, '/dummy-pr').map((each) => each.number),
    [165],
  );
  assert.deepEqual(
    visibleRequests(held, 'nothing').map((each) => each.number),
    [],
  );
});

test('open and draft requests sort above closed and merged, keeping host order', () => {
  const held = [
    request({ number: 1, state: 'merged' }),
    request({ number: 2, state: 'closed' }),
    request({ number: 3, state: 'open' }),
    request({ number: 4, state: 'draft' }),
    request({ number: 5, state: 'open' }),
  ];
  assert.deepEqual(
    visibleRequests(held, '').map((each) => each.number),
    [3, 4, 5, 1, 2],
  );
});
