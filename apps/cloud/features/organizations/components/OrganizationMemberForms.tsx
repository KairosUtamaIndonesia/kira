import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { CreateOrganizationResult } from "@/features/organizations/actions/types";
import type { OrganizationMember } from "@/features/organizations/types";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  inviteMemberAction,
  removeMemberAction,
  updateMemberRoleAction,
} from "@/features/organizations/actions/manageOrganization";
import {
  inviteMemberSchema,
  updateMemberRoleSchema,
} from "@/features/organizations/validation/manageOrganization";

const emptyResult: CreateOrganizationResult = { status: "success", message: "" };
const roles = ["owner", "admin", "member"] as const;
type OrganizationRoleValue = (typeof roles)[number];

function memberRoleValue(role: string): OrganizationRoleValue {
  if (role === "owner" || role === "admin" || role === "member") {
    return role;
  }

  return "member";
}

function fieldErrors(errors: Array<{ message: string } | undefined>) {
  return errors.flatMap((error) => {
    if (error === undefined) {
      return [];
    }

    return [{ message: error.message }];
  });
}

type InviteMemberFormProperties = {
  organizationId: string;
};

function InviteMemberForm({ organizationId }: InviteMemberFormProperties) {
  const router = useRouter();
  const [result, setResult] = useState<CreateOrganizationResult>(emptyResult);
  const form = useForm({
    defaultValues: { organizationId, email: "", role: "member" as OrganizationRoleValue },
    validators: { onSubmit: inviteMemberSchema },
    onSubmit: async ({ value }) => {
      const actionResult = await inviteMemberAction({ data: value });
      setResult(actionResult);

      if (actionResult.status === "success") {
        form.reset();
        await router.invalidate();
      }
    },
  });
  const hasMessage = result.message.length > 0;

  return (
    <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
      <div className="mb-4">
        <h2 className="font-medium">Invite member</h2>
        <p className="text-sm text-muted-foreground">
          Add an existing user immediately or create a pending invitation by email.
        </p>
      </div>
      <form
        className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_auto] md:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          form.handleSubmit();
        }}
      >
        <FieldGroup>
          <form.Field name="email">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="ben@kairos.dev"
                    autoComplete="email"
                    aria-invalid={isInvalid}
                  />
                  {isInvalid ? (
                    <FieldError errors={fieldErrors(field.state.meta.errors)} />
                  ) : undefined}
                </Field>
              );
            }}
          </form.Field>
        </FieldGroup>
        <form.Field name="role">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Role</FieldLabel>
              <select
                id={field.name}
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.target.value as OrganizationRoleValue)
                }
                className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "Inviting…" : "Invite member"}
            </Button>
          )}
        </form.Subscribe>
      </form>
      {hasMessage ? (
        <p
          className={
            result.status === "error"
              ? "mt-3 text-sm text-destructive"
              : "mt-3 text-sm text-muted-foreground"
          }
          aria-live="polite"
        >
          {result.message}
        </p>
      ) : undefined}
    </section>
  );
}

type MemberActionsProperties = {
  member: OrganizationMember;
};

function MemberActions({ member }: MemberActionsProperties) {
  const router = useRouter();
  const [result, setResult] = useState<CreateOrganizationResult>(emptyResult);
  const form = useForm({
    defaultValues: {
      organizationId: member.organizationId,
      memberId: member.id,
      role: memberRoleValue(member.role),
    },
    validators: { onSubmit: updateMemberRoleSchema },
    onSubmit: async ({ value }) => {
      const actionResult = await updateMemberRoleAction({ data: value });
      setResult(actionResult);

      if (actionResult.status === "success") {
        await router.invalidate();
      }
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          form.handleSubmit();
        }}
      >
        <form.Field name="role">
          {(field) => (
            <select
              aria-label={`Role for ${member.email}`}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value as OrganizationRoleValue)}
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {roles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" variant="outline" disabled={!canSubmit || isSubmitting}>
              Save role
            </Button>
          )}
        </form.Subscribe>
      </form>
      <Button
        type="button"
        variant="destructive"
        onClick={async () => {
          const actionResult = await removeMemberAction({
            data: {
              organizationId: member.organizationId,
              memberId: member.id,
            },
          });
          setResult(actionResult);

          if (actionResult.status === "success") {
            await router.invalidate();
          }
        }}
      >
        Remove
      </Button>
      {result.message.length > 0 ? (
        <span
          className={
            result.status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"
          }
        >
          {result.message}
        </span>
      ) : undefined}
    </div>
  );
}

export { InviteMemberForm, MemberActions };
