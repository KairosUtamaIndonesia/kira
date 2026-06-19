import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, ownerAc } from "better-auth/plugins/organization/access";

// ---------------------------------------------------------------------------
// Statement
// ---------------------------------------------------------------------------
// Resources and actions for the Kira org admin surface.
//
// member    — managing org members
// apiKey    — managing desktop access credentials
// sso       — configuring identity providers
// model     — managing AI model assignments
// org       — organization-level settings (rename, delete, set-active)
// ---------------------------------------------------------------------------

const statement = {
  ...defaultStatements,
  member: ["invite", "update", "remove"],
  apiKey: ["create", "revoke"],
  sso: ["configure"],
  model: ["create", "update", "delete"],
  org: ["update", "delete", "setActive"],
} as const;

const ac = createAccessControl(statement);

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
// owner    — full control including delete and SSO configuration
// admin    — manage members, API keys, and models; no delete, no SSO
// member   — no cloud admin permissions (desktop-only users)
// ---------------------------------------------------------------------------

const owner = ac.newRole({
  ...ownerAc.statements,
  member: ["invite", "update", "remove"],
  apiKey: ["create", "revoke"],
  sso: ["configure"],
  model: ["create", "update", "delete"],
  org: ["update", "delete", "setActive"],
});

const admin = ac.newRole({
  ...adminAc.statements,
  member: ["invite", "update", "remove"],
  apiKey: ["create", "revoke"],
  model: ["create", "update", "delete"],
  org: ["update", "setActive"],
});

const member = ac.newRole({
  // No cloud admin permissions.
  // Members access Kira through the desktop app only.
});

// ── Platform tier ──────────────────────────────────────────────────

const platformStatement = {
  platform: ["access_console", "manage_organizations", "manage_users", "manage_settings"],
  desktop: ["view_admin_features"],
} as const;

const platformAC = createAccessControl(platformStatement);

const platformAdminRole = platformAC.newRole({
  platform: ["access_console", "manage_organizations", "manage_users", "manage_settings"],
  desktop: ["view_admin_features"],
});

const platformUserRole = platformAC.newRole({
  // No platform permissions
});

export { ac, platformAC, admin, member, owner, platformAdminRole, platformUserRole };
