import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const desktopAccessPolicyStatus = pgEnum("desktop_access_policy_status", ["active", "disabled"]);

const desktopAccessCheckDecision = pgEnum("desktop_access_check_decision", ["allowed", "denied"]);

const desktopAccessPolicies = pgTable(
  "desktop_access_policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull(),
    minimumDesktopVersion: text("minimum_desktop_version").notNull(),
    status: desktopAccessPolicyStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("desktop_access_policies_organization_id_idx").on(table.organizationId)],
);

const desktopAccessChecks = pgTable(
  "desktop_access_checks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull(),
    apiKeyId: text("api_key_id").notNull(),
    desktopClientId: text("desktop_client_id").notNull(),
    appVersion: text("app_version").notNull(),
    platform: text("platform").notNull(),
    decision: desktopAccessCheckDecision("decision").notNull(),
    denialReason: text("denial_reason"),
    requestMetadata: jsonb("request_metadata").notNull().default({}),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("desktop_access_checks_organization_id_idx").on(table.organizationId),
    index("desktop_access_checks_checked_at_idx").on(table.checkedAt),
  ],
);

const organizationModels = pgTable(
  "organization_models",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull(),
    label: text("label").notNull(),
    upstreamModelId: text("upstream_model_id").notNull(),
    providerId: text("provider_id").notNull(),
    providerBaseUrl: text("provider_base_url").notNull(),
    contextWindow: integer("context_window").notNull(),
    maxOutputTokens: integer("max_output_tokens").notNull(),
    apiKey: text("api_key"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("organization_models_organization_id_idx").on(table.organizationId)],
);

const desktopSigninHandoffs = pgTable(
  "desktop_signin_handoffs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    handoffCodeHash: text("handoff_code_hash").notNull(),
    userId: text("user_id").notNull(),
    organizationId: text("organization_id").notNull(),
    organizationName: text("organization_name").notNull(),
    apiKey: text("api_key"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("desktop_signin_handoffs_handoff_code_hash_uidx").on(table.handoffCodeHash),
  ],
);

type DesktopAccessPolicy = typeof desktopAccessPolicies.$inferSelect;
type NewDesktopAccessPolicy = typeof desktopAccessPolicies.$inferInsert;
type DesktopAccessCheck = typeof desktopAccessChecks.$inferSelect;
type NewDesktopAccessCheck = typeof desktopAccessChecks.$inferInsert;
type OrganizationModel = typeof organizationModels.$inferSelect;
type NewOrganizationModel = typeof organizationModels.$inferInsert;
type DesktopSigninHandoff = typeof desktopSigninHandoffs.$inferSelect;
type NewDesktopSigninHandoff = typeof desktopSigninHandoffs.$inferInsert;

export {
  desktopAccessCheckDecision,
  desktopAccessChecks,
  desktopAccessPolicies,
  desktopAccessPolicyStatus,
  desktopSigninHandoffs,
  organizationModels,
};
export type {
  DesktopAccessCheck,
  DesktopAccessPolicy,
  DesktopSigninHandoff,
  NewDesktopAccessCheck,
  NewDesktopAccessPolicy,
  NewDesktopSigninHandoff,
  NewOrganizationModel,
  OrganizationModel,
};
