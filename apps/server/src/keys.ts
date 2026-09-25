import type { Auth } from './auth';

/** Who a Foundry key belongs to, as both the desktop and the pool route ask it. */
export interface HeldUser {
  id: string;
  email: string;
  name: string;
}

export type KeyHolder =
  | { readonly user: HeldUser }
  | { readonly refusal: { code: string; message: string } };

/**
 * The wall in front of anything that answers on a caller's behalf.
 *
 * Two routes ask this question — the desktop's own key check and the model
 * proxy — and a caller must not be able to get a different answer from one than
 * from the other, so it is written once here. Codes are what a client branches
 * on, so Better Auth's own are passed through rather than Foundry inventing new
 * names for the same conditions.
 */
export async function keyHolder(auth: Auth, request: Request): Promise<KeyHolder> {
  const key = presentedKey(request.headers.get('authorization'));
  if (!key) return refused('KEY_NOT_FOUND', 'No Foundry key was presented.');

  const verification = await auth.api.verifyApiKey({ body: { key } });
  if (!verification.valid || !verification.key) {
    return refused(
      asText(verification.error?.code) ?? 'INVALID_API_KEY',
      asText(verification.error?.message) ?? 'That key is not valid.',
    );
  }

  const context = await auth.$context;
  const user = await context.internalAdapter.findUserById(verification.key.referenceId);
  if (!user) return refused('KEY_NOT_FOUND', 'That key belongs to a user who is gone.');

  return { user: { id: user.id, email: user.email, name: user.name } };
}

function refused(code: string, message: string): KeyHolder {
  return { refusal: { code, message } };
}

/** The key a client presents, or null when the header carries none. */
function presentedKey(header: string | null): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '');
  return match?.[1]?.trim() || null;
}

/** Better Auth types its error fields as string-or-wrapped; take only the prose. */
function asText(field: unknown): string | undefined {
  return typeof field === 'string' ? field : undefined;
}
