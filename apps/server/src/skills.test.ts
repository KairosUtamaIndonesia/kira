import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { skillFile } from './schema';
import { bearer, boot, closeDatabases, issue, send, user } from './test-support/server';

afterEach(closeDatabases);
afterAll(closeDatabases);

interface SkillFile {
  path: string;
  content: string;
}

interface Skill {
  id: string;
  projectId: string;
  name: string;
  description: string;
  body: string;
  files: SkillFile[];
  author: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

function json(method: string, key: string, value: unknown): RequestInit {
  return {
    method,
    headers: { ...bearer(key), 'content-type': 'application/json' },
    body: JSON.stringify(value),
  };
}

type App = Awaited<ReturnType<typeof boot>>['app'];

async function project(app: App, key: string, prefix = 'FND') {
  const response = await send(
    app,
    '/api/projects',
    json('POST', key, { name: 'Kira', prefix }),
  );
  return (await response.json()).project as { id: string };
}

function write(app: App, key: string, projectId: string, body: unknown) {
  return send(app, `/api/projects/${projectId}/skills`, json('POST', key, body));
}

function edit(app: App, key: string, projectId: string, skillId: string, body: unknown) {
  return send(
    app,
    `/api/projects/${projectId}/skills/${skillId}`,
    json('PATCH', key, body),
  );
}

async function skills(app: App, key: string, projectId: string): Promise<Skill[]> {
  const response = await send(app, `/api/projects/${projectId}/skills`, { headers: bearer(key) });
  if (response.status !== 200) throw new Error(await response.text());
  return ((await response.json()) as { skills: Skill[] }).skills;
}

async function signedIn() {
  const { app, auth, database } = await boot();
  const person = await user(auth);
  const key = (await issue(auth, person.id, 'desktop')).key;
  return { app, key, person, database };
}

const REVIEW = {
  name: 'review-checklist',
  description: 'What every review must check before a change lands.',
  body: '# Review checklist\n\nRead the change, then read the tests.\n',
};

describe('a project skill', () => {
  test('starts absent in a fresh migrated project', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);

    expect(await skills(app, key, made.id)).toEqual([]);
  });

  test('is written and read back whole', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);

    const response = await write(app, key, made.id, REVIEW);
    expect(response.status).toBe(200);
    const { skill } = (await response.json()) as { skill: Skill };

    expect(skill).toMatchObject({
      projectId: made.id,
      name: 'review-checklist',
      description: REVIEW.description,
      body: REVIEW.body,
      files: [],
    });
    expect(await skills(app, key, made.id)).toEqual([skill]);
  });

  test('records who wrote it', async () => {
    const { app, key, person } = await signedIn();
    const made = await project(app, key);

    const response = await write(app, key, made.id, REVIEW);
    const { skill } = (await response.json()) as { skill: Skill };

    expect(skill.author).toEqual({ id: person.id, name: person.name });
  });

  test('carries the files that travel with it, in path order', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);

    const response = await write(app, key, made.id, {
      ...REVIEW,
      files: [
        { path: 'templates/report.md', content: 'Report.' },
        { path: 'checklist.md', content: 'Check.' },
      ],
    });
    const { skill } = (await response.json()) as { skill: Skill };

    expect(skill.files).toEqual([
      { path: 'checklist.md', content: 'Check.' },
      { path: 'templates/report.md', content: 'Report.' },
    ]);
  });

  test('normalizes a leading ./ on a file path', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);

    const response = await write(app, key, made.id, {
      ...REVIEW,
      files: [{ path: './checklist.md', content: 'Check.' }],
    });
    const { skill } = (await response.json()) as { skill: Skill };

    expect(skill.files).toEqual([{ path: 'checklist.md', content: 'Check.' }]);
  });

  test('trims the name and description it was given', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);

    const response = await write(app, key, made.id, {
      ...REVIEW,
      name: '  review-checklist  ',
      description: `  ${REVIEW.description}  `,
    });
    const { skill } = (await response.json()) as { skill: Skill };

    expect(skill.name).toBe('review-checklist');
    expect(skill.description).toBe(REVIEW.description);
  });
});


describe('what a skill may not be', () => {
  const CASES: Array<{ name: string; body: Record<string, unknown> }> = [
    { name: 'a name with an uppercase letter', body: { ...REVIEW, name: 'Review' } },
    { name: 'a name with a space', body: { ...REVIEW, name: 'review checklist' } },
    { name: 'a name with an underscore', body: { ...REVIEW, name: 'review_checklist' } },
    { name: 'a name starting with a hyphen', body: { ...REVIEW, name: '-review' } },
    { name: 'a name ending with a hyphen', body: { ...REVIEW, name: 'review-' } },
    { name: 'a name with consecutive hyphens', body: { ...REVIEW, name: 'review--checklist' } },
    { name: 'an empty name', body: { ...REVIEW, name: '' } },
    { name: 'a name past 64 characters', body: { ...REVIEW, name: 'a'.repeat(65) } },
    { name: 'an empty description', body: { ...REVIEW, description: '' } },
    { name: 'a whitespace description', body: { ...REVIEW, description: '   ' } },
    {
      name: 'a description past 1024 characters',
      body: { ...REVIEW, description: 'a'.repeat(1025) },
    },
    {
      name: 'a file claiming SKILL.md',
      body: { ...REVIEW, files: [{ path: 'SKILL.md', content: 'Mine.' }] },
    },
    {
      name: 'a file claiming skill.md in another case',
      body: { ...REVIEW, files: [{ path: 'skill.md', content: 'Mine.' }] },
    },
    {
      name: 'a file claiming ./SKILL.md',
      body: { ...REVIEW, files: [{ path: './SKILL.md', content: 'Mine.' }] },
    },
    {
      name: 'a file path climbing out of the skill',
      body: { ...REVIEW, files: [{ path: '../escape.md', content: 'Out.' }] },
    },
    {
      name: 'a file path climbing out mid-path',
      body: { ...REVIEW, files: [{ path: 'sub/../escape.md', content: 'Out.' }] },
    },
    {
      name: 'an absolute file path',
      body: { ...REVIEW, files: [{ path: '/etc/hosts', content: 'Out.' }] },
    },
    {
      name: 'an empty file path',
      body: { ...REVIEW, files: [{ path: '', content: 'Nothing.' }] },
    },
    {
      name: 'two files at the same path',
      body: {
        ...REVIEW,
        files: [
          { path: 'checklist.md', content: 'One.' },
          { path: 'checklist.md', content: 'Two.' },
        ],
      },
    },
    {
      name: 'two files that normalize to the same path',
      body: {
        ...REVIEW,
        files: [
          { path: 'checklist.md', content: 'One.' },
          { path: './checklist.md', content: 'Two.' },
        ],
      },
    },
  ];

  for (const testCase of CASES) {
    test(`is refused: ${testCase.name}`, async () => {
      const { app, key } = await signedIn();
      const made = await project(app, key);

      const response = await write(app, key, made.id, testCase.body);

      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'SKILL_INVALID',
      );
      expect(await skills(app, key, made.id)).toEqual([]);
    });
  }
});

describe('a name belongs to one project', () => {
  test('is refused twice in the same project', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    await write(app, key, made.id, REVIEW);

    const second = await write(app, key, made.id, REVIEW);

    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe(
      'SKILL_NAME_TAKEN',
    );
    expect((await skills(app, key, made.id)).length).toBe(1);
  });

  test('is free in another project', async () => {
    const { app, key } = await signedIn();
    const first = await project(app, key, 'FND');
    const second = await project(app, key, 'KRA');
    await write(app, key, first.id, REVIEW);

    const response = await write(app, key, second.id, REVIEW);

    expect(response.status).toBe(200);
    expect((await skills(app, key, second.id)).length).toBe(1);
  });

  test('is refused when an edit renames onto it', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    await write(app, key, made.id, REVIEW);
    const other = await write(app, key, made.id, { ...REVIEW, name: 'style-check' });
    const { skill } = (await other.json()) as { skill: Skill };

    const response = await edit(app, key, made.id, skill.id, { name: 'review-checklist' });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'SKILL_NAME_TAKEN',
    );
  });
});

describe('editing a skill', () => {
  test('leaves a field out and keeps it', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const first = await write(app, key, made.id, REVIEW);
    const { skill } = (await first.json()) as { skill: Skill };

    const response = await edit(app, key, made.id, skill.id, { body: '# Rewritten\n' });
    const { skill: edited } = (await response.json()) as { skill: Skill };

    expect(edited.body).toBe('# Rewritten\n');
    expect(edited.name).toBe(skill.name);
    expect(edited.description).toBe(skill.description);
    expect(edited.updatedAt >= skill.updatedAt).toBe(true);
  });

  test('leaves the files alone when the edit omits them', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const first = await write(app, key, made.id, {
      ...REVIEW,
      files: [{ path: 'checklist.md', content: 'Check.' }],
    });
    const { skill } = (await first.json()) as { skill: Skill };

    const response = await edit(app, key, made.id, skill.id, { body: '# Rewritten\n' });
    const { skill: edited } = (await response.json()) as { skill: Skill };

    expect(edited.files).toEqual([{ path: 'checklist.md', content: 'Check.' }]);
  });

  test('replaces the whole file set when the edit sends one', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const first = await write(app, key, made.id, {
      ...REVIEW,
      files: [
        { path: 'checklist.md', content: 'Check.' },
        { path: 'templates/report.md', content: 'Report.' },
      ],
    });
    const { skill } = (await first.json()) as { skill: Skill };

    const response = await edit(app, key, made.id, skill.id, {
      files: [{ path: 'templates/report.md', content: 'Report, twice.' }],
    });
    const { skill: edited } = (await response.json()) as { skill: Skill };

    expect(edited.files).toEqual([{ path: 'templates/report.md', content: 'Report, twice.' }]);
  });

  test('empties the file set when the edit sends an empty one', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const first = await write(app, key, made.id, {
      ...REVIEW,
      files: [{ path: 'checklist.md', content: 'Check.' }],
    });
    const { skill } = (await first.json()) as { skill: Skill };

    const response = await edit(app, key, made.id, skill.id, { files: [] });
    const { skill: edited } = (await response.json()) as { skill: Skill };

    expect(edited.files).toEqual([]);
  });

  test('is refused when it would make the skill invalid', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const first = await write(app, key, made.id, REVIEW);
    const { skill } = (await first.json()) as { skill: Skill };

    const response = await edit(app, key, made.id, skill.id, { name: 'Not A Slug' });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'SKILL_INVALID',
    );
    expect((await skills(app, key, made.id))[0]?.name).toBe(skill.name);
  });
});


describe('deleting a skill', () => {
  test('removes it and the files that travelled with it', async () => {
    const { app, key, database } = await signedIn();
    const made = await project(app, key);
    const first = await write(app, key, made.id, {
      ...REVIEW,
      files: [{ path: 'checklist.md', content: 'Check.' }],
    });
    const { skill } = (await first.json()) as { skill: Skill };

    const response = await send(
      app,
      `/api/projects/${made.id}/skills/${skill.id}`,
      { method: 'DELETE', headers: bearer(key) },
    );

    expect(response.status).toBe(200);
    expect(await skills(app, key, made.id)).toEqual([]);
    // The files go with it through the foreign key, so an orphaned row here
    // would be a skill_file that no skill can ever reach again.
    expect(await database.select().from(skillFile)).toEqual([]);
  });
});

describe('a skill that is not there', () => {
  test('is not found when the project is unknown', async () => {
    const { app, key } = await signedIn();

    const response = await write(app, key, 'no-such-project', REVIEW);

    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'PROJECT_NOT_FOUND',
    );
  });

  test('is not found when the skill is unknown', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);

    const response = await edit(app, key, made.id, 'no-such-skill', { body: 'Anything.' });

    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'SKILL_NOT_FOUND',
    );
  });

  test('is not found in another project', async () => {
    const { app, key } = await signedIn();
    const first = await project(app, key, 'FND');
    const second = await project(app, key, 'KRA');
    const written = await write(app, key, first.id, REVIEW);
    const { skill } = (await written.json()) as { skill: Skill };

    const response = await edit(app, key, second.id, skill.id, { body: 'Anything.' });

    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'SKILL_NOT_FOUND',
    );
  });
});

