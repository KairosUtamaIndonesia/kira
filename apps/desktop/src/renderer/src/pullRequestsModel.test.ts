import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checksWord, rowLabel, stateWord } from './pullRequestsModel.ts';

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
