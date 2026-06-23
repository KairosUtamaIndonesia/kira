type OrganizationStatus = "active";

type Organization = {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  memberCount: number;
  apiKeyCount: number;
  createdAt: string;
};

type OrganizationMember = {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: string;
  status: "active";
  joinedAt: string;
};

type OrganizationInvitation = {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  invitedAt: string;
};

type OrganizationApiKey = {
  id: string;
  organizationId: string;
  name: string;
  prefix: string;
  start: string;
  permissions: string[];
  lastUsedAt: string;
  expiresAt: string;
  status: "active" | "expired" | "disabled";
  userName: string | undefined;
  userEmail: string | undefined;
};

type OrganizationModel = {
  id: string;
  organizationId: string;
  label: string;
  upstreamModelId: string;
  providerId: string;
  /** Resolved from organization_providers at query time, not stored on the model. */
  providerBaseUrl: string | undefined;
  providerConfigId: string;
  maxInputTokens: number | undefined;
  contextWindow: number;
  maxOutputTokens: number;
  isDefault: boolean;
  /** Resolved from organization_providers at query time, not stored on the model. */
  apiKey: string | undefined;
  capabilities:
    | {
        reasoning?: boolean;
        thinking?: boolean;
        tool_calling?: boolean;
        vision?: boolean;
      }
    | undefined;
  createdAt: string;
};

type OrganizationProvider = {
  id: string;
  organizationId: string;
  label: string;
  providerId: string;
  providerBaseUrl: string;
  apiKey: string | undefined;
  modelsEndpoint: string | undefined;
  createdAt: string;
};

type PublicOrganizationProvider = Omit<OrganizationProvider, "apiKey">;

export type {
  Organization,
  OrganizationApiKey,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationModel,
  OrganizationProvider,
  PublicOrganizationProvider,
  OrganizationStatus,
};
