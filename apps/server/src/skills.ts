/**
 * A project's skills, owned by the server rather than by a folder.
 *
 * A skill is a method a project works by: a name pi invokes it under, the
 * description it is offered with, the body that becomes its instructions, and
 * any reference files that travel beside it
 * (docs/adr/0027-project-skills-live-in-the-store.md).
 *
 * The name and the description are validated here rather than stored as
 * written, because pi's loader decides what a skill is from them: a skill with
 * no description does not load at all, and a name that is not lowercase letters,
 * digits and single hyphens loads with a warning nobody sees. Kira writes the
 * frontmatter when it materializes the skill, so what is stored is the one
 * shape pi is guaranteed to accept.
 *
 * The body is not validated. It is Markdown that becomes instructions, exactly
 * as a bundled skill is.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { Auth } from './auth';
import type { Database } from './database';
import { keyHolder, type HeldUser } from './keys';
import { REFUSAL, refusal } from './refusals';
import { project, skill, skillFile, user } from './schema';

/** pi's own limit, and its rule: lowercase letters, digits, single hyphens. */
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The file Kira writes a skill's body to. A reference file may not claim it,
 * because the body already does — and pi reads a skill by exactly this name, so
 * a supporting file that took it would be the skill's instructions rather than
 * a file beside them.
 */
const BODY_FILENAME = 'SKILL.md';

const AUTHOR = t.Union([t.Object({ id: t.String(), name: t.String() }), t.Null()]);
const FILE = t.Object({ path: t.String(), content: t.String() });
const SKILL = t.Object({
  id: t.String(),
  projectId: t.String(),
  name: t.String(),
  description: t.String(),
  body: t.String(),
  files: t.Array(FILE),
  author: AUTHOR,
  createdAt: t.String(),
  updatedAt: t.String(),
});
const LIST = t.Object({ skills: t.Array(SKILL) });
const ONE = t.Object({ skill: SKILL });

type FileInput = { path: string; content: string };
type SkillInput = { name: string; description: string; body: string; files: FileInput[] };

/**
 * What a person wrote, or null when it is not a skill pi can load.
 *
 * Everything is trimmed before it is judged, so a name typed with a stray space
 * is the same name rather than a refusal about whitespace — and a description
 * that is only whitespace is empty, which is what pi would decide too.
 */
function skillInput(body: {
  name: string;
  description: string;
  body: string;
  files?: FileInput[];
}): SkillInput | null {
  const name = body.name.trim();
  const description = body.description.trim();
  if (!NAME.test(name) || name.length > MAX_NAME) return null;
  if (description === '' || description.length > MAX_DESCRIPTION) return null;

  const files = body.files ?? [];
  const seen = new Set<string>();
  for (const file of files) {
    const path = referencePath(file.path);
    if (path === null || seen.has(path)) return null;
    seen.add(path);
  }

  return {
    name,
    description,
    body: body.body,
    files: files.map((file) => ({ path: referencePath(file.path)!, content: file.content })),
  };
}

/**
 * A reference file's path, normalized, or null when it would not stay inside
 * the skill's own directory.
 *
 * The path is written to disk when the skill reaches a chat, so a path that
 * climbs out of the skill directory is the one shape here that has to be
 * refused rather than stored: `../` is how a skill would write somewhere it was
 * never given.
 */
function referencePath(path: string): string | null {
  const cleaned = path.trim().replaceAll('\\', '/').replace(/^\.\//, '');
  if (cleaned === '' || cleaned.startsWith('/')) return null;
  if (cleaned.split('/').some((segment) => segment === '' || segment === '..')) return null;
  if (cleaned.toLowerCase() === BODY_FILENAME.toLowerCase()) return null;
  return cleaned;
}

/**
 * The Postgres error code behind a failed query.
 *
 * Drizzle raises its own error and keeps the driver's on `cause`, so the code a
 * unique violation carries (`23505`) is one or two links down rather than on the
 * error that reaches here.
 */
function postgresCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined;
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

type Asking = { readonly refused: ReturnType<typeof refusal> } | { readonly user: HeldUser };

async function asking(auth: Auth, request: Request): Promise<Asking> {
  const held = await keyHolder(auth, request);
  if ('refusal' in held) return { refused: refusal(held.refusal.code, held.refusal.message) };
  return { user: held.user };
}

export function createSkills({ auth, database }: { auth: Auth; database: Database }) {
  return new Elysia()
    .get(
      '/api/projects/:ref/skills',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await projectFor(database, params.ref);
        if (found === null) return status(404, refusal('PROJECT_NOT_FOUND', 'No such project.'));

        return { skills: await asSkills(database, await readSkills(database, found.id)) };
      },
      {
        params: t.Object({ ref: t.String() }),
        response: { 200: LIST, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: "Read a project's skills" },
      },
    )
    .post(
      '/api/projects/:ref/skills',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await projectFor(database, params.ref);
        if (found === null) return status(404, refusal('PROJECT_NOT_FOUND', 'No such project.'));

        const input = skillInput(body);
        if (input === null) return status(400, refusal('SKILL_INVALID', invalidMessage));

        const made = {
          id: randomUUID(),
          projectId: found.id,
          name: input.name,
          description: input.description,
          body: input.body,
          authorId: held.user.id,
        };

        try {
          await database.transaction(async (transaction) => {
            await transaction.insert(skill).values(made);
            await writeFiles(transaction, made.id, input.files);
          });
        } catch (error) {
          if (postgresCode(error) === '23505') {
            return status(409, refusal('SKILL_NAME_TAKEN', takenMessage(input.name)));
          }
          throw error;
        }

        const created = await oneSkill(database, found.id, made.id);
        if (created === null) throw new Error('A skill that was just written is gone.');
        return { skill: (await asSkills(database, [created]))[0]! };
      },
      {
        body: t.Object({
          name: t.String(),
          description: t.String(),
          body: t.String(),
          files: t.Optional(t.Array(FILE)),
        }),
        response: { 200: ONE, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL, 409: REFUSAL },
        detail: { summary: 'Write a skill a project works by' },
      },
    )
    .patch(
      '/api/projects/:ref/skills/:skillId',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await projectFor(database, params.ref);
        if (found === null) return status(404, refusal('PROJECT_NOT_FOUND', 'No such project.'));

        const current = await oneSkill(database, found.id, params.skillId);
        if (current === null) return status(404, refusal('SKILL_NOT_FOUND', missingMessage));

        const input = skillInput({
          name: body.name ?? current.name,
          description: body.description ?? current.description,
          body: body.body ?? current.body,
          files: body.files,
        });
        if (input === null) return status(400, refusal('SKILL_INVALID', invalidMessage));

        try {
          await database.transaction(async (transaction) => {
            await transaction
              .update(skill)
              .set({
                name: input.name,
                description: input.description,
                body: input.body,
                updatedAt: new Date(),
              })
              .where(eq(skill.id, current.id));
            // The files arrive as the whole set, because a skill is one object:
            // an edit that emptied the set must empty it, or a reference file the
            // body no longer mentions would outlive the text that cited it.
            if (body.files !== undefined) {
              await transaction.delete(skillFile).where(eq(skillFile.skillId, current.id));
              await writeFiles(transaction, current.id, input.files);
            }
          });
        } catch (error) {
          if (postgresCode(error) === '23505') {
            return status(409, refusal('SKILL_NAME_TAKEN', takenMessage(input.name)));
          }
          throw error;
        }

        const updated = await oneSkill(database, found.id, current.id);
        return { skill: (await asSkills(database, [updated!]))[0]! };
      },
      {
        body: t.Object({
          name: t.Optional(t.String()),
          description: t.Optional(t.String()),
          body: t.Optional(t.String()),
          files: t.Optional(t.Array(FILE)),
        }),
        params: t.Object({ ref: t.String(), skillId: t.String() }),
        response: { 200: ONE, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL, 409: REFUSAL },
        detail: { summary: 'Change a skill, or the files that travel with it' },
      },
    )
    .delete(
      '/api/projects/:ref/skills/:skillId',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await projectFor(database, params.ref);
        if (found === null) return status(404, refusal('PROJECT_NOT_FOUND', 'No such project.'));

        const current = await oneSkill(database, found.id, params.skillId);
        if (current === null) return status(404, refusal('SKILL_NOT_FOUND', missingMessage));

        // The files go with it through the foreign key rather than by hand.
        await database.delete(skill).where(eq(skill.id, current.id));

        return { removed: true };
      },
      {
        params: t.Object({ ref: t.String(), skillId: t.String() }),
        response: {
          200: t.Object({ removed: t.Boolean() }),
          401: REFUSAL,
          404: REFUSAL,
        },
        detail: { summary: 'Delete a skill and the files that travel with it' },
      },
    );
}

const invalidMessage =
  'A skill needs a name of lowercase letters, digits and single hyphens, a description, and reference files that stay inside the skill.';
const takenMessage = (name: string) => `This project already has a skill named ${name}.`;

/** The write half of the database, as a transaction hands it over. */
type Writer = Pick<Database, 'insert' | 'delete'>;

async function readSkills(database: Database, projectId: string) {
  return await database
    .select()
    .from(skill)
    .where(eq(skill.projectId, projectId))
    .orderBy(asc(skill.name));
}

async function oneSkill(database: Database, projectId: string, skillId: string) {
  const [found] = await database
    .select()
    .from(skill)
    .where(and(eq(skill.id, skillId), eq(skill.projectId, projectId)));
  return found ?? null;
}

/**
 * The skills as a client reads them, with their files and who wrote them.
 *
 * The bodies come back with the list rather than from a second call, which is
 * the opposite of the choice Multica had to make: its list endpoint dropped
 * bodies because a two-minute CLI could not carry them. A chat reads every
 * skill it is about to write to disk, so it needs the whole set either way, and
 * one round trip is the smaller answer at the size a project's skills reach.
 */
async function asSkills(database: Database, rows: (typeof skill.$inferSelect)[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const files = await database
    .select()
    .from(skillFile)
    .where(inArray(skillFile.skillId, ids))
    .orderBy(asc(skillFile.path));

  const authorIds = [...new Set(rows.map((row) => row.authorId).filter(isText))];
  const people =
    authorIds.length === 0
      ? []
      : await database
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, authorIds));
  const authors = new Map(people.map((person) => [person.id, person]));

  const bySkill = new Map<string, typeof files>();
  for (const file of files) bySkill.set(file.skillId, [...(bySkill.get(file.skillId) ?? []), file]);

  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    body: row.body,
    files: (bySkill.get(row.id) ?? []).map((file) => ({ path: file.path, content: file.content })),
    author: row.authorId === null ? null : (authors.get(row.authorId) ?? null),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

async function writeFiles(writer: Writer, skillId: string, files: FileInput[]) {
  if (files.length === 0) return;
  await writer.insert(skillFile).values(files.map((file) => ({ id: randomUUID(), skillId, ...file })));
}

function isText(value: string | null): value is string {
  return value !== null;
}
const missingMessage = 'No such skill in this project.';

async function projectFor(database: Database, id: string) {
  const [found] = await database.select().from(project).where(eq(project.id, id));
  return found ?? null;
}
