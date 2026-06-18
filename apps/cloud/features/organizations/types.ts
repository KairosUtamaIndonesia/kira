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
  providerBaseUrl: string;
  contextWindow: number;
  maxOutputTokens: number;
  isDefault: boolean;
  apiKey: string | undefined;
  createdAt: string;
};

export type {
  Organization,
  OrganizationApiKey,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationModel,
  OrganizationStatus,
};
