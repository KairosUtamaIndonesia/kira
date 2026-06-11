import { count, eq } from "drizzle-orm";

import type { PlatformUser } from "@/features/users/types";

import { member, user } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function platformRole(role: string | null) {
  return role ?? "user";
}

function platformStatus(banned: boolean | null) {
  return banned === true ? "suspended" : "active";
}

async function listPlatformUsersForAdmin(): Promise<PlatformUser[]> {
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
      createdAt: user.createdAt,
      organizationCount: count(member.id),
    })
    .from(user)
    .leftJoin(member, eq(member.userId, user.id))
    .groupBy(user.id)
    .orderBy(user.createdAt);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    platformRole: platformRole(row.role),
    organizationCount: row.organizationCount,
    status: platformStatus(row.banned),
    createdAt: formatDate(row.createdAt),
  }));
}

export { listPlatformUsersForAdmin };
