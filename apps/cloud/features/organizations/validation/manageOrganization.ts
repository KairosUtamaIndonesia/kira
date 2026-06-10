import * as z from "zod";

const organizationRoleSchema = z.enum(["owner", "admin", "member"]);

const inviteMemberSchema = z.object({
  organizationId: z.string().min(1, "Organization is required."),
  email: z.email("Enter a valid email address."),
  role: organizationRoleSchema,
});

const updateMemberRoleSchema = z.object({
  organizationId: z.string().min(1, "Organization is required."),
  memberId: z.string().min(1, "Member is required."),
  role: organizationRoleSchema,
});

const removeMemberSchema = z.object({
  organizationId: z.string().min(1, "Organization is required."),
  memberId: z.string().min(1, "Member is required."),
});

const renameOrganizationSchema = z.object({
  organizationId: z.string().min(1, "Organization is required."),
  name: z.string().trim().min(2, "Organization name must be at least 2 characters."),
});

const deleteOrganizationSchema = z.object({
  organizationId: z.string().min(1, "Organization is required."),
  confirmationName: z.string().trim().min(1, "Type the organization name to confirm."),
});

const setActiveOrganizationSchema = z.object({
  organizationId: z.string().min(1, "Organization is required."),
});

type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
type RemoveMemberInput = z.infer<typeof removeMemberSchema>;
type RenameOrganizationInput = z.infer<typeof renameOrganizationSchema>;
type DeleteOrganizationInput = z.infer<typeof deleteOrganizationSchema>;
type SetActiveOrganizationInput = z.infer<typeof setActiveOrganizationSchema>;
type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export {
  deleteOrganizationSchema,
  inviteMemberSchema,
  organizationRoleSchema,
  removeMemberSchema,
  renameOrganizationSchema,
  setActiveOrganizationSchema,
  updateMemberRoleSchema,
};
export type {
  DeleteOrganizationInput,
  InviteMemberInput,
  OrganizationRole,
  RemoveMemberInput,
  RenameOrganizationInput,
  SetActiveOrganizationInput,
  UpdateMemberRoleInput,
};
