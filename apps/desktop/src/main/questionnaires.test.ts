import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ChatEvent, QuestionnaireParams, QuestionnaireResult } from '../preload/bridge.ts';
import { questionnaireResponse, Questionnaires } from './questionnaires.ts';

const params: QuestionnaireParams = {
  questions: [
    {
      question: 'Which cache should we use?',
      header: 'Cache',
      options: [
        { label: 'Memory', description: 'Fast, but process-local.' },
        { label: 'Redis', description: 'Shared across processes.' },
      ],
    },
  ],
};

const answer: QuestionnaireResult = {
  cancelled: false,
  answers: [
    {
      questionIndex: 0,
      question: 'Which cache should we use?',
      kind: 'option',
      answer: 'Redis',
    },
  ],
};

test('a questionnaire waits for an answer to its own request', async () => {
  const events: ChatEvent[] = [];
  const questionnaires = new Questionnaires((event) => events.push(event));
  const waiting = questionnaires.ask('chat-1', params, new AbortController().signal);
  const opened = events.find((event) => event.type === 'questionnaire-opened');

  assert.ok(opened && opened.type === 'questionnaire-opened');
  assert.equal(opened.threadId, 'chat-1');
  assert.deepEqual(opened.questions, params.questions);
  assert.equal(questionnaires.submit('chat-2', opened.requestId, answer), false);
  assert.equal(questionnaires.submit('chat-1', 'another-request', answer), false);
  assert.equal(questionnaires.submit('chat-1', opened.requestId, answer), true);
  assert.deepEqual(await waiting, answer);
  assert.deepEqual(
    events.filter((event) => event.type === 'questionnaire-closed'),
    [{ type: 'questionnaire-closed', threadId: 'chat-1', requestId: opened.requestId }],
  );
});

test('a cancelled questionnaire returns a decline result to Kira', async () => {
  const events: ChatEvent[] = [];
  const questionnaires = new Questionnaires((event) => events.push(event));
  const waiting = questionnaires.ask('chat-1', params);
  const opened = events.find((event) => event.type === 'questionnaire-opened');
  assert.ok(opened && opened.type === 'questionnaire-opened');

  assert.equal(questionnaires.cancel('chat-1', opened.requestId), true);
  assert.deepEqual(await waiting, { cancelled: true, answers: [] });
});

test('aborting a turn closes its questionnaire and settles the waiting tool', async () => {
  const events: ChatEvent[] = [];
  const questionnaires = new Questionnaires((event) => events.push(event));
  const controller = new AbortController();
  const waiting = questionnaires.ask('chat-1', params, controller.signal);

  controller.abort();

  await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(events.at(-1)?.type, 'questionnaire-closed');
});

test('an already aborted turn never opens a questionnaire', async () => {
  const events: ChatEvent[] = [];
  const questionnaires = new Questionnaires((event) => events.push(event));
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(questionnaires.ask('chat-1', params, controller.signal), {
    name: 'AbortError',
  });
  assert.deepEqual(events, []);
});

test('answers cannot add options, and selected previews come from the question', async () => {
  const withPreviews: QuestionnaireParams = {
    questions: [
      {
        question: 'Which deployment targets should be included?',
        header: 'Targets',
        multiSelect: true,
        options: [
          { label: 'Desktop', description: 'Desktop apps.', preview: 'Desktop rollout.' },
          { label: 'Web', description: 'Web apps.', preview: 'Web rollout.' },
        ],
      },
    ],
  };
  const questionnaires = new Questionnaires(() => {});
  const waiting = questionnaires.ask('chat-1', withPreviews);
  const request = questionnaires.current('chat-1');
  assert.ok(request);

  assert.equal(
    questionnaires.submit('chat-1', request.requestId, {
      cancelled: false,
      answers: [
        {
          questionIndex: 0,
          question: 'forged question',
          kind: 'multi',
          selected: ['Desktop', 'Unknown'],
        },
      ],
    }),
    false,
  );
  assert.equal(
    questionnaires.submit('chat-1', request.requestId, {
      cancelled: false,
      answers: [
        {
          questionIndex: 0,
          question: 'forged question',
          kind: 'multi',
          selected: ['Desktop', 'Web'],
          preview: 'forged preview',
        },
      ],
    }),
    true,
  );
  assert.deepEqual(await waiting, {
    cancelled: false,
    answers: [
      {
        questionIndex: 0,
        question: 'Which deployment targets should be included?',
        kind: 'multi',
        answer: null,
        selected: ['Desktop', 'Web'],
        preview: 'Desktop rollout.\n\nWeb rollout.',
      },
    ],
  });
});

test('two chats keep independent pending questionnaires and reject stale ids', async () => {
  const events: ChatEvent[] = [];
  const questionnaires = new Questionnaires((event) => events.push(event));
  const firstWaiting = questionnaires.ask('chat-1', params);
  const secondWaiting = questionnaires.ask('chat-2', params);
  const firstRequest = questionnaires.current('chat-1');
  const secondRequest = questionnaires.current('chat-2');
  assert.ok(firstRequest);
  assert.ok(secondRequest);
  assert.notEqual(firstRequest.requestId, secondRequest.requestId);

  assert.equal(questionnaires.cancel('chat-2', firstRequest.requestId), false);
  assert.equal(questionnaires.submit('chat-1', secondRequest.requestId, answer), false);
  assert.equal(questionnaires.submit('chat-1', firstRequest.requestId, answer), true);
  assert.deepEqual(await firstWaiting, answer);
  assert.equal(questionnaires.cancel('chat-2', secondRequest.requestId), true);
  assert.deepEqual(await secondWaiting, { cancelled: true, answers: [] });
  assert.equal(questionnaires.cancel('chat-2', secondRequest.requestId), false);
  assert.equal(events.filter((event) => event.type === 'questionnaire-closed').length, 2);
});

test('closing all questionnaires rejects every waiter and clears each chat', async () => {
  const events: ChatEvent[] = [];
  const questionnaires = new Questionnaires((event) => events.push(event));
  const firstWaiting = questionnaires.ask('chat-1', params);
  const secondWaiting = questionnaires.ask('chat-2', params);

  questionnaires.closeAll();

  await Promise.all([
    assert.rejects(firstWaiting, { name: 'AbortError' }),
    assert.rejects(secondWaiting, { name: 'AbortError' }),
  ]);
  assert.equal(questionnaires.current('chat-1'), null);
  assert.equal(questionnaires.current('chat-2'), null);
  assert.equal(events.filter((event) => event.type === 'questionnaire-closed').length, 2);
});

test('a note alone can be submitted and returned to Kira', async () => {
  const questionnaires = new Questionnaires(() => {});
  const waiting = questionnaires.ask('chat-1', params);
  const request = questionnaires.current('chat-1');
  assert.ok(request);

  assert.equal(
    questionnaires.submit('chat-1', request.requestId, {
      cancelled: false,
      answers: [],
      globalNote: 'Keep the design simple',
    }),
    true,
  );
  const result = await waiting;
  assert.deepEqual(result, {
    cancelled: false,
    answers: [],
    globalNote: 'Keep the design simple',
  });
  assert.equal(
    questionnaireResponse(result),
    "User has answered your questions:\nGlobal note: Keep the design simple\nContinue with the user's answers in mind.",
  );
});

test('submitting no answer and no note uses the canonical decline response', async () => {
  const questionnaires = new Questionnaires(() => {});
  const waiting = questionnaires.ask('chat-1', params);
  const request = questionnaires.current('chat-1');
  assert.ok(request);

  assert.equal(
    questionnaires.submit('chat-1', request.requestId, { cancelled: false, answers: [] }),
    true,
  );
  const result = await waiting;
  assert.deepEqual(result, { answers: [], cancelled: true });
  assert.equal(questionnaireResponse(result), 'User declined to answer questions.');
});

test('custom answers and per-question notes are returned intact', async () => {
  const questionnaires = new Questionnaires(() => {});
  const waiting = questionnaires.ask('chat-1', params);
  const request = questionnaires.current('chat-1');
  assert.ok(request);

  assert.equal(
    questionnaires.submit('chat-1', request.requestId, {
      cancelled: false,
      answers: [
        {
          questionIndex: 0,
          kind: 'custom',
          answer: 'Use SQLite for now',
          notes: 'We can revisit after measuring load.',
        },
      ],
    }),
    true,
  );
  const result = await waiting;
  assert.deepEqual(result.answers, [
    {
      questionIndex: 0,
      question: 'Which cache should we use?',
      kind: 'custom',
      answer: 'Use SQLite for now',
      notes: 'We can revisit after measuring load.',
    },
  ]);
  assert.match(questionnaireResponse(result), /User note: We can revisit after measuring load\./);
});

test('a lost close event does not leave the tool waiting forever', async () => {
  const questionnaires = new Questionnaires((event) => {
    if (event.type === 'questionnaire-closed') {
      throw new Error('The window has closed.');
    }
  });
  const waiting = questionnaires.ask('chat-1', params);
  const request = questionnaires.current('chat-1');
  assert.ok(request);

  assert.equal(questionnaires.cancel('chat-1', request.requestId), true);
  assert.deepEqual(await waiting, { answers: [], cancelled: true });
  assert.equal(questionnaires.current('chat-1'), null);
});

test('a failed open event rejects and cleans up its waiting tool', async () => {
  const questionnaires = new Questionnaires(() => {
    throw new Error('The window has closed.');
  });
  const waiting = questionnaires.ask('chat-1', params);

  await assert.rejects(waiting, /The window has closed/);
  assert.equal(questionnaires.current('chat-1'), null);
});
