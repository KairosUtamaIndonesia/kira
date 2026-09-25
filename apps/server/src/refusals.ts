import { t } from 'elysia';

/**
 * The shape Kira answers a refusal with.
 *
 * OpenAI's error envelope, because `/v1/*` is an OpenAI-compatible surface and pi
 * parses these shapes (docs/adr/0005-allowances.md). `code` is what a client
 * branches on, `message` is what a person reads, and `type` is the envelope's own
 * kind where the refusal has one — a request past somebody's allowance is
 * `insufficient_quota`, which is the word OpenAI uses for the same situation.
 *
 * Written once here rather than per route, so a refusal cannot arrive in one shape
 * from the model proxy and another from the platform API.
 */
export const REFUSAL = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String(),
    type: t.Optional(t.String()),
  }),
});

export function refusal(code: string, message: string, type?: string) {
  return { error: { code, message, ...(type === undefined ? {} : { type }) } };
}
