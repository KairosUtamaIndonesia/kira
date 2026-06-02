import type { PlatformUser } from "../types";

const users: PlatformUser[] = [
  {
    id: "user_ada",
    name: "Ada Lovelace",
    email: "ada@acme.test",
    platformRole: "platform_admin",
    organizationCount: 1,
    status: "active",
    createdAt: "2026-05-12",
  },
  {
    id: "user_grace",
    name: "Grace Hopper",
    email: "grace@acme.test",
    platformRole: "user",
    organizationCount: 1,
    status: "active",
    createdAt: "2026-05-13",
  },
  {
    id: "user_margaret",
    name: "Margaret Hamilton",
    email: "margaret@northstar.test",
    platformRole: "platform_support",
    organizationCount: 2,
    status: "active",
    createdAt: "2026-05-20",
  },
];

function listUsers() {
  return users;
}

export { listUsers };
