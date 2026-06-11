import * as z from "zod";

const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Organization name must be at least 2 characters."),
});

type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

function createOrganizationSlug(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length === 0) {
    throw new Error("Organization name must include at least one letter or number.");
  }

  return slug;
}

export { createOrganizationSchema, createOrganizationSlug };
export type { CreateOrganizationInput };
