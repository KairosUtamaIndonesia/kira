import { getRequest } from "@tanstack/react-start/server";
import { eq, and } from "drizzle-orm";

import { auth } from "@/lib/auth/auth";
import { member, organization } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";

// ---------------------------------------------------------------------------
// requirePlatformAdmin
// ---------------------------------------------------------------------------
// Asserts the current request is authenticated and that the session user holds
// the platform-admin role (Better Auth `admin` plugin).  Returns the session so
// callers can read user/session fields without a second round-trip.
//
// Throws on any auth failure.  MUST be called inside every platform-scoped
// server-fn handler; the SPA `beforeLoad` guard is a UX gate, not a security
// boundary.
// ---------------------------------------------------------------------------

async function requirePlatformAdmin() {
  const headers = getRequest().headers;
  const session = await auth.api.getSession({ headers });

  if (session === null) {
    throw new Error("Sign in before performing this action.");
  }

  if (session.user.role !== "admin") {
    throw new Error("Only platform admins can perform this action.");
  }

  return session;
}

// ---------------------------------------------------------------------------
// requireOrgRole
// ---------------------------------------------------------------------------
// Asserts the current request is authenticated and that the session user is a
// member of `organizationId` with a role in `allowedRoles` (default: owner or
// admin).  Returns `{ session, member }` so callers avoid a second DB hit.
//
// Throws on any auth or authorization failure.  MUST be called inside every
// org-scoped server-fn handler.
// ---------------------------------------------------------------------------

type OrgRole = "owner" | "admin" | "member";

type RequireOrgRoleResult = {
  session: Awaited<ReturnType<typeof auth.api.getSession>> & {};
  memberRow: { id: string; role: string };
};

async function requireOrgRole(
  organizationId: string,
  allowedRoles: OrgRole[] = ["owner", "admin"],
): Promise<RequireOrgRoleResult> {
  const headers = getRequest().headers;
  const session = await auth.api.getSession({ headers });

  if (session === null) {
    throw new Error("Sign in before performing this action.");
  }

  const [memberRow] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
    .limit(1);

  if (memberRow === undefined) {
    throw new Error("You are not a member of this organization.");
  }

  if (!(allowedRoles as string[]).includes(memberRow.role)) {
    throw new Error(`This action requires one of the following roles: ${allowedRoles.join(", ")}.`);
  }

  return { session, memberRow };
}

// ---------------------------------------------------------------------------
// requireOrganization
// ---------------------------------------------------------------------------
// Loads the organization row and throws if it does not exist.
// Call after requirePlatformAdmin / requireOrgRole to confirm the target org.
// ---------------------------------------------------------------------------

async function requireOrganization(organizationId: string) {
  const [row] = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  if (row === undefined) {
    throw new Error("Organization was not found.");
  }

  return row;
}

export { requireOrgRole, requireOrganization, requirePlatformAdmin };
export type { OrgRole };
