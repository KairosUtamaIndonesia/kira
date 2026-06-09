import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
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
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("organization_models_organization_id_idx").on(table.organizationId)],
);

type DesktopAccessPolicy = typeof desktopAccessPolicies.$inferSelect;
type NewDesktopAccessPolicy = typeof desktopAccessPolicies.$inferInsert;
type DesktopAccessCheck = typeof desktopAccessChecks.$inferSelect;
type NewDesktopAccessCheck = typeof desktopAccessChecks.$inferInsert;
type OrganizationModel = typeof organizationModels.$inferSelect;
type NewOrganizationModel = typeof organizationModels.$inferInsert;

export {
  desktopAccessCheckDecision,
  desktopAccessChecks,
  desktopAccessPolicies,
  desktopAccessPolicyStatus,
  organizationModels,
};
export type {
  DesktopAccessCheck,
  DesktopAccessPolicy,
  NewDesktopAccessCheck,
  NewDesktopAccessPolicy,
  NewOrganizationModel,
  OrganizationModel,
};
