"use client";

import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import type { CreateOrganizationResult } from "@/features/organizations/actions/types";
import type { Organization } from "@/features/organizations/types";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  deleteOrganizationAction,
  renameOrganizationAction,
  setActiveOrganizationAction,
} from "@/features/organizations/actions/manageOrganization";
import {
  deleteOrganizationSchema,
  renameOrganizationSchema,
} from "@/features/organizations/validation/manageOrganization";

const emptyResult: CreateOrganizationResult = { status: "success", message: "" };

function fieldErrors(errors: Array<{ message: string } | undefined>) {
  return errors.flatMap((error) => {
    if (error === undefined) {
      return [];
    }

    return [{ message: error.message }];
  });
}

type OrganizationSettingsFormsProperties = {
  organization: Organization;
  isCurrentActiveOrganization: boolean;
};

function OrganizationSettingsForms({
  organization,
  isCurrentActiveOrganization,
}: OrganizationSettingsFormsProperties) {
  return (
    <div className="space-y-6">
      <ActiveOrganizationForm
        organization={organization}
        isCurrentActiveOrganization={isCurrentActiveOrganization}
      />
      <RenameOrganizationForm organization={organization} />
      <DeleteOrganizationForm organization={organization} />
    </div>
  );
}

type OrganizationFormProperties = {
  organization: Organization;
};

type ActiveOrganizationFormProperties = OrganizationFormProperties & {
  isCurrentActiveOrganization: boolean;
};

function ActiveOrganizationForm({
  organization,
  isCurrentActiveOrganization,
}: ActiveOrganizationFormProperties) {
  const [result, setResult] = useState<CreateOrganizationResult>(emptyResult);

  return (
    <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-medium">Active organization</h2>
          <p className="text-sm text-muted-foreground">
            Set {organization.name} as the active organization for your current admin session.
          </p>
        </div>
        <Button
          type="button"
          variant={isCurrentActiveOrganization ? "secondary" : "default"}
          disabled={isCurrentActiveOrganization}
          onClick={async () => {
            setResult(await setActiveOrganizationAction({ organizationId: organization.id }));
          }}
        >
          {isCurrentActiveOrganization ? "Currently active" : "Set active"}
        </Button>
      </div>
      {result.message.length > 0 ? (
        <p
          className={
            result.status === "error"
              ? "mt-3 text-sm text-destructive"
              : "mt-3 text-sm text-muted-foreground"
          }
        >
          {result.message}
        </p>
      ) : undefined}
    </section>
  );
}

function RenameOrganizationForm({ organization }: OrganizationFormProperties) {
  const [result, setResult] = useState<CreateOrganizationResult>(emptyResult);
  const form = useForm({
    defaultValues: { organizationId: organization.id, name: organization.name },
    validators: { onSubmit: renameOrganizationSchema },
    onSubmit: async ({ value }) => setResult(await renameOrganizationAction(value)),
  });

  return (
    <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
      <div className="mb-4">
        <h2 className="font-medium">Rename organization</h2>
        <p className="text-sm text-muted-foreground">
          Update the organization name and derived slug.
        </p>
      </div>
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          form.handleSubmit();
        }}
      >
        <FieldGroup className="flex-1">
          <form.Field name="name">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>Organization name</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
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
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              Save name
            </Button>
          )}
        </form.Subscribe>
      </form>
      {result.message.length > 0 ? (
        <p
          className={
            result.status === "error"
              ? "mt-3 text-sm text-destructive"
              : "mt-3 text-sm text-muted-foreground"
          }
        >
          {result.message}
        </p>
      ) : undefined}
    </section>
  );
}

function DeleteOrganizationForm({ organization }: OrganizationFormProperties) {
  const [result, setResult] = useState<CreateOrganizationResult>(emptyResult);
  const form = useForm({
    defaultValues: { organizationId: organization.id, confirmationName: "" },
    validators: { onSubmit: deleteOrganizationSchema },
    onSubmit: async ({ value }) => setResult(await deleteOrganizationAction(value)),
  });

  return (
    <section className="rounded-xl border border-destructive/30 bg-card p-4 text-card-foreground">
      <div className="mb-4">
        <h2 className="font-medium text-destructive">Delete organization</h2>
        <p className="text-sm text-muted-foreground">
          This permanently deletes {organization.name}, its members, invitations, and related Better
          Auth organization data.
        </p>
      </div>
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          form.handleSubmit();
        }}
      >
        <FieldGroup className="flex-1">
          <form.Field name="confirmationName">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>Type {organization.name} to confirm</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
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
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" variant="destructive" disabled={!canSubmit || isSubmitting}>
              Delete organization
            </Button>
          )}
        </form.Subscribe>
      </form>
      {result.message.length > 0 ? (
        <p
          className={
            result.status === "error"
              ? "mt-3 text-sm text-destructive"
              : "mt-3 text-sm text-muted-foreground"
          }
        >
          {result.message}
        </p>
      ) : undefined}
    </section>
  );
}

export { OrganizationSettingsForms };
