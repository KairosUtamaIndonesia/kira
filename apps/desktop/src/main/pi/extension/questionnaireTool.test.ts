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
  const questionnaires = new Questionnaires(() => {});
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
