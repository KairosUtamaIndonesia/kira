type OrganizationStatus = "active" | "setup" | "suspended";

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
  role: "owner" | "admin" | "member" | "billing" | "viewer";
  status: "active" | "invited";
  joinedAt: string;
};

type OrganizationApiKey = {
  id: string;
  organizationId: string;
  name: string;
  prefix: string;
  permissions: string[];
  lastUsedAt: string;
  expiresAt: string;
  status: "active" | "expired" | "revoked";
};

export type { Organization, OrganizationApiKey, OrganizationMember, OrganizationStatus };
