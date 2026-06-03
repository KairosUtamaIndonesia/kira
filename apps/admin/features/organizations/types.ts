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
};

export type { Organization, OrganizationApiKey, OrganizationMember, OrganizationStatus };
