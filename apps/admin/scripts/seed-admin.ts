import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth/auth";
import { user } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";
import { requireEnvironmentVariable } from "@/lib/env";

const seedAdminEmail = requireEnvironmentVariable("SEED_ADMIN_EMAIL");
const seedAdminPassword = requireEnvironmentVariable("SEED_ADMIN_PASSWORD");
const seedAdminName = requireEnvironmentVariable("SEED_ADMIN_NAME");

async function findUserByEmail(email: string) {
  const users = await db.select().from(user).where(eq(user.email, email)).limit(1);
  const matchingUser = users[0];

  return matchingUser;
}

async function ensureSeedAdmin() {
  const existingUser = await findUserByEmail(seedAdminEmail);

  if (existingUser === undefined) {
    await auth.api.signUpEmail({
      body: {
        email: seedAdminEmail,
        password: seedAdminPassword,
        name: seedAdminName,
      },
    });

    const createdUser = await findUserByEmail(seedAdminEmail);

    if (createdUser === undefined) {
      throw new Error(`Seed admin was not created: ${seedAdminEmail}`);
    }

    await ensureAdminRole(createdUser.id, createdUser.role);
    process.stdout.write(`Created seed admin user: ${seedAdminEmail}\n`);
    return;
  }

  await ensureAdminRole(existingUser.id, existingUser.role);
  process.stdout.write(`Seed admin user already exists: ${seedAdminEmail}\n`);
}

async function ensureAdminRole(userId: string, currentRole: string | null) {
  if (currentRole === "admin") {
    process.stdout.write("Seed admin role already set.\n");
    return;
  }

  await db.update(user).set({ role: "admin" }).where(eq(user.id, userId));
  process.stdout.write("Seed admin role set to admin.\n");
}

await ensureSeedAdmin();
