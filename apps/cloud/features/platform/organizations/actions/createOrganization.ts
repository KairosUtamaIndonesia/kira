import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";

import type { CreateOrganizationResult } from "@/features/organizations/actions/types";
import type { CreateOrganizationInput } from "@/features/organizations/validation/createOrganization";

import {
  createOrganizationSchema,
  createOrganizationSlug,
} from "@/features/organizations/validation/createOrganization";
import { auth } from "@/lib/auth/auth";
import { organization } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";

async function ensureOrganizationSlugAvailable(slug: string) {
  const [existingOrganization] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1);

  if (existingOrganization !== undefined) {
    throw new Error(`Organization slug is already in use: ${slug}`);
  }
}

const createOrganizationAction = createServerFn({ method: "POST" })
  .validator((input: CreateOrganizationInput) => input)
  .handler(async ({ data: input }): Promise<CreateOrganizationResult> => {
    const requestHeaders = getRequest().headers;
    const session = await auth.api.getSession({ headers: requestHeaders });

    if (session === null) {
      return {
        status: "error",
        message: "Sign in before creating an organization.",
      };
    }

    if (session.user.role !== "admin") {
      return {
        status: "error",
        message: "Only platform admins can create organizations.",
      };
    }

    try {
      const parsedInput = createOrganizationSchema.parse(input);
      const slug = createOrganizationSlug(parsedInput.name);
      await ensureOrganizationSlugAvailable(slug);

      await auth.api.createOrganization({
        headers: requestHeaders,
        body: {
          name: parsedInput.name,
          slug,
          keepCurrentActiveOrganization: true,
        },
      });

      return {
        status: "success",
        message: `Created ${parsedInput.name}.`,
      };
    } catch (error) {
      if (error instanceof Error) {
        return {
          status: "error",
          message: error.message,
        };
      }

      return {
        status: "error",
        message: "Organization could not be created.",
      };
    }
  });

export { createOrganizationAction };
