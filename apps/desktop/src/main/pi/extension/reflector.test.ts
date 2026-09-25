import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { StoredReflection } from '../../db/threads.ts';
import type { HeldObservation, ObservationKind, Relevance } from './memory.ts';
import { conclusionsIn, reflectionPrompt } from './reflector.ts';

/** One thing the chat noticed, as the ledger holds it. */
function noticed(
  entryId: string,
  text: string,
  { kind = 'goal', relevance = 'high' }: { kind?: ObservationKind; relevance?: Relevance } = {},
): HeldObservation {
  return { entryId, at: '2026-09-21T15:00:00.000Z', kind, relevance, text };
}

/** One thing the chat already concluded. */
function concluded(text: string, coversThrough: number | null = 4): StoredReflection {
  return { id: 1, text, coversThrough };
}

const NUMBERS = new Map([
  ['e1', 1],
  ['e2', 4],
]);

test('the reflector is told what the chat noticed, by turn and by weight', () => {
  const prompt = reflectionPrompt(
    [
      noticed('e1', 'the config lives in deploy.toml'),
      noticed('e2', 'read src/ship.ts', { kind: 'read', relevance: 'low' }),
    ],
    NUMBERS,
    [],
  );

  // The ledger reaches the model as evidence, not as text: what a thing was, how
  // much it mattered and which turn it came from are what let a conclusion be
  // drawn about it rather than restated from it.
  assert.ok(
    prompt.includes('- [1] goal high: the config lives in deploy.toml'),
    `the first thing noticed is missing from:\n${prompt}`,
  );
  assert.ok(
    prompt.includes('- [4] read low: read src/ship.ts'),
    `the second thing noticed is missing from:\n${prompt}`,
  );
});

test('a thing the chat no longer holds is shown without a turn to check', () => {
  const prompt = reflectionPrompt([noticed('gone', 'the queue was rejected')], NUMBERS, []);

  assert.ok(
    prompt.includes('- goal high: the queue was rejected'),
    `a thing with no number should still be shown, but got:\n${prompt}`,
  );
});

test('what the chat already concluded is shown, so it is not concluded again', () => {
  const prompt = reflectionPrompt([noticed('e1', 'deploys run on Fridays')], NUMBERS, [
    concluded('deploys only run on Fridays before 3pm'),
    concluded('the queue was rejected'),
  ]);

  assert.ok(prompt.includes('- deploys only run on Fridays before 3pm'), prompt);
  assert.ok(prompt.includes('- the queue was rejected'), prompt);
});

test('a chat holding nothing says so rather than saying nothing', () => {
  const prompt = reflectionPrompt([noticed('e1', 'something')], NUMBERS, []);

  // An absent section reads as a section the model was not given. What the chat
  // is holding has to be stated on both sides, including when the answer is
  // nothing, or the first conclusion drawn on a fresh chat is drawn blind.
  assert.ok(prompt.includes('Nothing yet.'), prompt);
});

test('the reflector is told what a conclusion has to be, and that none is an answer', () => {
  const prompt = reflectionPrompt([noticed('e1', 'something')], NUMBERS, []);

  assert.ok(prompt.includes('One conclusion per line'), prompt);
  assert.ok(prompt.includes('Do not restate'), prompt);
  assert.ok(prompt.includes('Reply with nothing at all'), prompt);

  // The rules are the whole prompt: the model is given no tools, so anything it
  // is not told here it cannot do.
  assert.equal(
    prompt,
    `${[
      'You keep the long memory of a chat. You are given what the chat noticed and what it has already concluded, and you draw the conclusions worth keeping.',
      'A conclusion is a durable thing a later reader must know and could not work out again from the words alone: a decision and why it was made, a constraint, a correction, what the work turned out to be.',
      'Do not restate what is already concluded, reword it, or split it. Emit only what is new.',
      'One conclusion per line, plain prose. No headings, bullets, numbering or code fences — a line is read as it stands.',
      'A conclusion must stand on its own: name the file, the command or the decision it is about rather than referring to a turn by number.',
      'Say why, not only what. A conclusion without its reason cannot be acted on.',
      'What the person asked for is authoritative; their words beat any inference.',
      'Fewer is better, and none is a real answer: most of what a chat notices is working state that will not matter later. Reply with nothing at all if nothing has settled.',
      '',
      '## Already concluded',
      'Nothing yet.',
      '',
      '## Noticed',
      '- [1] goal high: something',
    ].join('\n')}`,
  );
});

/**
 * What a model's answer is read back as.
 *
 * Every case is one answer and the conclusions in it. The shape a model writes in
 * is not the shape a conclusion has — it reaches for the habits of prose, a heading
 * before a list and a bullet or a number on each line — so this is where those are
 * stripped, and nowhere else is: a line that carries no words of its own, or only
 * introduces the ones under it, is not a conclusion.
 */
const READ_BACK: Array<{ what: string; answer: string; conclusions: string[] }> = [
  {
    what: 'plain lines are the conclusions',
    answer: 'The queue was rejected for ingest.\nDeploys run on Fridays.',
    conclusions: ['The queue was rejected for ingest.', 'Deploys run on Fridays.'],
  },
  {
    what: 'a bullet is not part of the conclusion',
    answer: '- Deploys run on Fridays before 3pm.\n* The person prefers bun over npm.',
    conclusions: ['Deploys run on Fridays before 3pm.', 'The person prefers bun over npm.'],
  },
  {
    what: 'a number is not part of the conclusion',
    answer: '1. Auth tokens are minted per device.\n2) The cache is dropped on deploy.',
    conclusions: ['Auth tokens are minted per device.', 'The cache is dropped on deploy.'],
  },
  {
    what: 'a heading introduces and is not one',
    answer: '# Conclusions\nThe queue was rejected.',
    conclusions: ['The queue was rejected.'],
  },
  {
    what: 'a line that only introduces the rest is not one',
    answer: 'Here are the conclusions:\nThe queue was rejected.',
    conclusions: ['The queue was rejected.'],
  },
  {
    what: 'blank lines are not conclusions',
    answer: 'The queue was rejected.\n\n   \n',
    conclusions: ['The queue was rejected.'],
  },
  {
    what: 'an answer with only whitespace contributes nothing',
    answer: '\n  \n',
    conclusions: [],
  },
  {
    what: 'a model that says nothing contributes nothing',
    answer: '',
    conclusions: [],
  },
];

for (const one of READ_BACK) {
  test(`an answer is read as its conclusions: ${one.what}`, () => {
    assert.deepEqual(conclusionsIn(one.answer), one.conclusions);
  });
}

test('one pass can only add so much', () => {
  const answer = Array.from({ length: 12 }, (_each, index) => `conclusion ${index}`).join('\n');

  // A model that answers with a page of conclusions is not drawing conclusions
  // any more; the cap is what keeps one bad pass from becoming the chat's memory
  // of itself.
  assert.equal(conclusionsIn(answer).length, 5);
});
