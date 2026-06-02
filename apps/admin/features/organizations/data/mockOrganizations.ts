import type { Organization, OrganizationApiKey, OrganizationMember } from "../types";

const organizations: Organization[] = [
  {
    id: "org_acme",
    name: "Acme Labs",
    slug: "acme-labs",
    status: "active",
    memberCount: 12,
    apiKeyCount: 3,
    createdAt: "2026-05-12",
  },
  {
    id: "org_northstar",
    name: "Northstar Studio",
    slug: "northstar-studio",
    status: "setup",
    memberCount: 4,
    apiKeyCount: 1,
    createdAt: "2026-05-24",
  },
  {
    id: "org_vector",
    name: "Vector Works",
    slug: "vector-works",
    status: "active",
    memberCount: 28,
    apiKeyCount: 6,
    createdAt: "2026-04-30",
  },
];

const members: OrganizationMember[] = [
  {
    id: "member_ada",
    organizationId: "org_acme",
    name: "Ada Lovelace",
    email: "ada@acme.test",
    role: "owner",
    status: "active",
    joinedAt: "2026-05-12",
  },
  {
    id: "member_grace",
    organizationId: "org_acme",
    name: "Grace Hopper",
    email: "grace@acme.test",
    role: "admin",
    status: "active",
    joinedAt: "2026-05-13",
  },
  {
    id: "member_katherine",
    organizationId: "org_acme",
    name: "Katherine Johnson",
    email: "katherine@acme.test",
    role: "member",
    status: "invited",
    joinedAt: "2026-05-28",
  },
];

const apiKeys: OrganizationApiKey[] = [
  {
    id: "key_desktop_prod",
    organizationId: "org_acme",
    name: "Desktop production access",
    prefix: "kira_prod",
    permissions: ["desktopAccess:read"],
    lastUsedAt: "2026-06-01",
    expiresAt: "2026-12-01",
    status: "active",
  },
  {
    id: "key_desktop_dev",
    organizationId: "org_acme",
    name: "Desktop development access",
    prefix: "kira_dev",
    permissions: ["desktopAccess:read", "desktopAccess:grant"],
    lastUsedAt: "Never",
    expiresAt: "2026-07-01",
    status: "active",
  },
];

function listOrganizations() {
  return organizations;
}

function getOrganization(organizationId: string) {
  return organizations.find((organization) => organization.id === organizationId);
}

function listOrganizationMembers(organizationId: string) {
  return members.filter((member) => member.organizationId === organizationId);
}

function listOrganizationApiKeys(organizationId: string) {
  return apiKeys.filter((apiKey) => apiKey.organizationId === organizationId);
}

export { getOrganization, listOrganizationApiKeys, listOrganizationMembers, listOrganizations };
