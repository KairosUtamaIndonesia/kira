import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Check } from 'typebox/value';
import { questionnaireSchema, Questionnaires } from '../../questionnaires.ts';
import { questionnaireTool } from './questionnaireTool.ts';

test('the questionnaire schema bounds question and option counts', () => {
  const question = {
    question: 'Which cache should be used?',
    header: 'Cache',
    options: [
      { label: 'Memory', description: 'Local only.' },
      { label: 'Redis', description: 'Shared.' },
    ],
  };
  const cases = [
    { questions: [question], want: true },
    { questions: [], want: false },
    {
      questions: Array.from({ length: 5 }, (_, index) => ({
        ...question,
        question: `Question ${index}`,
      })),
      want: false,
    },
    { questions: [{ ...question, options: [question.options[0]] }], want: false },
    {
      questions: [
        { ...question, options: [...question.options, ...question.options, question.options[0]] },
      ],
      want: false,
    },
  ];
  for (const { questions, want } of cases) {
    assert.equal(Check(questionnaireSchema, { questions }), want);
  }
});

test('the ask-user tool returns the submitted answer to Kira', async () => {
  let opened!: () => void;
  const requestOpened = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const questionnaires = new Questionnaires((event) => {
    if (event.type === 'questionnaire-opened') opened();
  });
  const tool = questionnaireTool(questionnaires, 'chat-1');
  const running = tool.execute('call-1', {
    questions: [
      {
        question: 'Which cache should be used?',
        header: 'Cache',
        options: [
          { label: 'Memory', description: 'Local only.' },
          { label: 'Redis', description: 'Shared.' },
        ],
      },
    ],
  });
  await requestOpened;
  const request = questionnaires.current('chat-1');
  assert.ok(request);

  assert.equal(
    questionnaires.submit('chat-1', request.requestId, {
      cancelled: false,
      answers: [
        {
          questionIndex: 0,
          question: request.questions[0]?.question,
          kind: 'option',
          answer: 'Redis',
        },
      ],
    }),
    true,
  );
  const result = await running;
  assert.deepEqual(result.content, [
    {
      type: 'text',
      text: 'User has answered your questions:\n- "Which cache should be used?": "Redis"\nContinue with the user\'s answers in mind.',
    },
  ]);
});

test('a child asks Kira first and returns her answer without opening a person questionnaire', async () => {
  const questionnaires = new Questionnaires(() => {});
  let asked = '';
  const tool = questionnaireTool(
    questionnaires,
    'chat-1',
    undefined,
    undefined,
    async (question) => {
      asked = question;
      return 'The project uses Redis, as decided in the earlier chat.';
    },
  );

  const result = await tool.execute('call-1', {
    questions: [
      {
        question: 'Which cache should be used?',
        header: 'Cache',
        options: [
          { label: 'Memory', description: 'Local only.' },
          { label: 'Redis', description: 'Shared.' },
        ],
      },
    ],
  });

  assert.match(asked, /Which cache should be used/);
  assert.match(asked, /Redis: Shared/);
  assert.match(result.content[0]?.type === 'text' ? result.content[0].text : '', /Kira answered/);
  assert.equal(questionnaires.current('chat-1'), null);
});

test('a child escalates to the person when Kira cannot answer', async () => {
  let opened!: () => void;
  const requestOpened = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const questionnaires = new Questionnaires((event) => {
    if (event.type === 'questionnaire-opened') opened();
  });
  const tool = questionnaireTool(
    questionnaires,
    'chat-1',
    undefined,
    undefined,
    async () => "I don't know from this chat's context.",
  );
  const running = tool.execute('call-1', {
    questions: [
      {
        question: 'Which cache should be used?',
        header: 'Cache',
        options: [
          { label: 'Memory', description: 'Local only.' },
          { label: 'Redis', description: 'Shared.' },
        ],
      },
    ],
  });
  await requestOpened;
  const request = questionnaires.current('chat-1');
  assert.ok(request);
  assert.equal(
    questionnaires.submit('chat-1', request.requestId, {
      cancelled: false,
      answers: [
        {
          questionIndex: 0,
          question: request.questions[0]?.question,
          kind: 'option',
          answer: 'Redis',
        },
      ],
    }),
    true,
  );
  const result = await running;
  assert.match(
    result.content[0]?.type === 'text' ? result.content[0].text : '',
    /User has answered/,
  );
});

test('the ask-user tool refuses duplicate questions, duplicate options, and reserved labels', async () => {
  const tool = questionnaireTool(new Questionnaires(() => {}), 'chat-1');
  const valid = {
    header: 'Cache',
    options: [
      { label: 'Memory', description: 'Local only.' },
      { label: 'Redis', description: 'Shared.' },
    ],
  };
  const cases = [
    {
      questions: [
        { ...valid, question: 'Which cache should be used?' },
        { ...valid, question: 'Which cache should be used?' },
      ],
      error: 'Question text must be unique.',
    },
    {
      questions: [
        {
          ...valid,
          question: 'Which cache should be used?',
          options: [
            { label: 'Memory', description: 'Local only.' },
            { label: 'Memory', description: 'Shared.' },
          ],
        },
      ],
      error: 'Option labels must be unique within each question.',
    },
    {
      questions: [
        {
          ...valid,
          question: 'Which cache should be used?',
          options: [
            { label: 'Other', description: 'Local only.' },
            { label: 'Redis', description: 'Shared.' },
          ],
        },
      ],
      error: 'Option labels cannot be reserved (Other, Type something., Next).',
    },
  ];

  for (const { questions, error } of cases) {
    const result = await tool.execute('call-1', { questions });
    assert.deepEqual(result.content, [{ type: 'text', text: `Error: ${error}` }]);
  }
});
