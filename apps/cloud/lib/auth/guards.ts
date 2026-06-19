import { getRequest } from "@tanstack/react-start/server";
import { and, eq } from "drizzle-orm";

import { auth } from "@/lib/auth/auth";
import {
  ac,
  admin,
  member as memberRole,
  owner,
  platformAdminRole,
  platformUserRole,
} from "@/lib/auth/permissions";
import { member as memberTable, organization } from "@/lib/db/auth-schema";
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

  const platformRoles = { platform_admin: platformAdminRole, user: platformUserRole } as const;
  const roleObj = platformRoles[session.user.role as keyof typeof platformRoles];
  if (roleObj === undefined || !roleObj.authorize({ platform: ["access_console"] }).success) {
    throw new Error("Only platform admins can perform this action.");
  }

  return session;
}

// ---------------------------------------------------------------------------
// requireOrgRole
// ---------------------------------------------------------------------------
// Asserts the current request is authenticated and that the session user is an
// owner or admin of `organizationId`.  Returns `{ session, memberRow }` so
// callers avoid a second DB hit.
//
// For finer-grained checks, follow with `requireOrgPermission`.
//
// Throws on any auth or authorization failure.  MUST be called inside every
// org-scoped server-fn handler.
// ---------------------------------------------------------------------------

type OrgMemberRow = { id: string; role: string };

// Map DB role string → role object so we can call .authorize().
const orgRoles = { owner, admin, member: memberRole } as const;
type OrgRoleName = keyof typeof orgRoles;

function resolveOrgRole(role: string): (typeof orgRoles)[OrgRoleName] | undefined {
  if (role === "owner" || role === "admin" || role === "member") {
    return orgRoles[role];
  }
  return undefined;
}
type RequireOrgRoleResult = {
  session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
  memberRow: OrgMemberRow;
};

async function requireOrgRole(organizationId: string): Promise<RequireOrgRoleResult> {
  const headers = getRequest().headers;
  const session = await auth.api.getSession({ headers });

  if (session === null) {
    throw new Error("Sign in before performing this action.");
  }

  const [memberRow] = await db
    .select({ id: memberTable.id, role: memberTable.role })
    .from(memberTable)
    .where(
      and(eq(memberTable.userId, session.user.id), eq(memberTable.organizationId, organizationId)),
    )
    .limit(1);

  if (memberRow === undefined) {
    throw new Error("You are not a member of this organization.");
  }

  const roleObj = resolveOrgRole(memberRow.role);
  const canAccessOrgAdmin = roleObj !== undefined && roleObj.authorize({ org: ["update"] }).success;

  if (!canAccessOrgAdmin) {
    throw new Error("You do not have permission to access the admin panel for this organization.");
  }

  return { session, memberRow };
}

function isPlatformAdmin(role: string | null | undefined): boolean {
  const platformRoles = { platform_admin: platformAdminRole, user: platformUserRole } as const;
  const roleObj = platformRoles[(role ?? "") as keyof typeof platformRoles];
  return roleObj !== undefined && roleObj.authorize({ platform: ["access_console"] }).success;
}

// ---------------------------------------------------------------------------
// requireOrgPermission
// ---------------------------------------------------------------------------
// Extends `requireOrgRole` with a specific permission check.  Use this for
// individual actions that require more than org-admin access (e.g. owner-only
// delete, SSO configuration).
//
// Usage:
//   await requireOrgPermission(orgId, { sso: ["configure"] });
//   await requireOrgPermission(orgId, { org: ["delete"] });
// ---------------------------------------------------------------------------

type OrgPermission = Parameters<ReturnType<typeof ac.newRole>["authorize"]>[0];

async function requireOrgPermission(
  organizationId: string,
  permission: OrgPermission,
): Promise<RequireOrgRoleResult> {
  const result = await requireOrgRole(organizationId);

  const roleObj = resolveOrgRole(result.memberRow.role);
  const hasPermission = roleObj !== undefined && roleObj.authorize(permission).success;

  if (!hasPermission) {
    throw new Error("You do not have permission to perform this action.");
  }

  return result;
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

export {
  requireOrgPermission,
  requireOrgRole,
  resolveOrgRole,
  requireOrganization,
  requirePlatformAdmin,
  isPlatformAdmin,
};
