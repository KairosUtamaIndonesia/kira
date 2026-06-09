import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { CreateOrganizationResult } from "@/features/organizations/actions/types";
import type { Organization } from "@/features/organizations/types";
import type { OrganizationSsoConnection, SsoActionResult } from "@/features/sso/types";

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
import {
  registerAzureSsoProviderAction,
  requestSsoDomainVerificationAction,
  verifySsoDomainAction,
} from "@/features/sso/actions/manageSsoProvider";

const emptyResult: CreateOrganizationResult = { status: "success", message: "" };
const emptySsoResult: SsoActionResult = { status: "success", message: "" };

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
  ssoConnection: OrganizationSsoConnection | undefined;
};

function OrganizationSettingsForms({
  organization,
  isCurrentActiveOrganization,
  ssoConnection,
}: OrganizationSettingsFormsProperties) {
  return (
    <div className="space-y-6">
      <ActiveOrganizationForm
        organization={organization}
        isCurrentActiveOrganization={isCurrentActiveOrganization}
      />
      <SingleSignOnForm organization={organization} ssoConnection={ssoConnection} />
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
  const router = useRouter();

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
            const actionResult = await setActiveOrganizationAction({
              data: { organizationId: organization.id },
            });
            setResult(actionResult);

            if (actionResult.status === "success") {
              await router.invalidate();
            }
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

type SingleSignOnFormProperties = OrganizationFormProperties & {
  ssoConnection: OrganizationSsoConnection | undefined;
};

function SingleSignOnForm({ organization, ssoConnection }: SingleSignOnFormProperties) {
  const [result, setResult] = useState<SsoActionResult>(emptySsoResult);
  const router = useRouter();
  const form = useForm({
    defaultValues: {
      organizationId: organization.id,
      organizationSlug: organization.slug,
      tenantId: "",
      domain: "",
      clientId: "",
      clientSecret: "",
    },
    onSubmit: async ({ value }) => {
      const actionResult = await registerAzureSsoProviderAction({ data: value });
      setResult(actionResult);

      if (actionResult.status === "success") {
        await router.invalidate();
      }
    },
  });

  if (ssoConnection !== undefined) {
    return (
      <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-medium">Single Sign-On</h2>
            <p className="text-sm text-muted-foreground">
              {organization.name} signs in through an organization-scoped identity provider.
            </p>
          </div>
          <span className="rounded-full border border-border px-2.5 py-1 text-xs font-medium capitalize">
            {ssoConnection.status.replaceAll("_", " ")}
          </span>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Provider ID</dt>
            <dd className="mt-1 font-mono text-xs">{ssoConnection.providerId}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Email domain</dt>
            <dd className="mt-1">{ssoConnection.domain}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Issuer</dt>
            <dd className="mt-1 font-mono text-xs break-all">{ssoConnection.issuer}</dd>
          </div>
        </dl>
        {ssoConnection.domainVerified ? undefined : (
          <div className="mt-4 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
            <p>
              Add the Better Auth domain verification TXT record for {ssoConnection.domain}, then
              verify the domain.
            </p>
            {result.domainVerificationRecord === undefined ? (
              <p className="mt-2">
                If you do not have the TXT value, request a new verification record.
              </p>
            ) : (
              <DomainVerificationRecord record={result.domainVerificationRecord} />
            )}
          </div>
        )}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            type="button"
            variant="secondary"
            disabled={ssoConnection.domainVerified}
            onClick={async () => {
              const actionResult = await verifySsoDomainAction({
                data: {
                  organizationId: organization.id,
                  providerId: ssoConnection.providerId,
                },
              });
              setResult(actionResult);

              if (actionResult.status === "success") {
                await router.invalidate();
              }
            }}
          >
            {ssoConnection.domainVerified ? "Domain verified" : "Verify domain"}
          </Button>
          {ssoConnection.domainVerified ? undefined : (
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                const actionResult = await requestSsoDomainVerificationAction({
                  data: {
                    organizationId: organization.id,
                    providerId: ssoConnection.providerId,
                  },
                });
                setResult(actionResult);

                if (actionResult.status === "success") {
                  await router.invalidate();
                }
              }}
            >
              Request TXT record
            </Button>
          )}
          {result.message.length > 0 ? (
            <p
              className={
                result.status === "error"
                  ? "text-sm text-destructive"
                  : "text-sm text-muted-foreground"
              }
            >
              {result.message}
            </p>
          ) : undefined}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
      <div className="mb-4">
        <h2 className="font-medium">Single Sign-On</h2>
        <p className="text-sm text-muted-foreground">
          Register Azure Entra ID SSO for {organization.name}. Users from this domain will be routed
          to the organization identity provider.
        </p>
      </div>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          form.handleSubmit();
        }}
      >
        <form.Field name="tenantId">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Azure tenant ID</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                required
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="domain">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Email domain</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                placeholder="kairos.com"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                required
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="clientId">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Client ID</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                required
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="clientSecret">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Client secret</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                type="password"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                required
              />
            </Field>
          )}
        </form.Field>
        <div className="sm:col-span-2">
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit || isSubmitting}>
                Register Azure SSO
              </Button>
            )}
          </form.Subscribe>
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
          {result.domainVerificationRecord === undefined ? undefined : (
            <DomainVerificationRecord record={result.domainVerificationRecord} />
          )}
        </div>
      </form>
    </section>
  );
}

type DomainVerificationRecordProperties = {
  record: {
    host: string;
    value: string;
  };
};

function DomainVerificationRecord({ record }: DomainVerificationRecordProperties) {
  return (
    <dl className="mt-3 grid gap-2 rounded-lg border border-border bg-background p-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted-foreground">TXT host</dt>
        <dd className="mt-1 font-mono text-xs break-all">{record.host}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">TXT value</dt>
        <dd className="mt-1 font-mono text-xs break-all">{record.value}</dd>
      </div>
    </dl>
  );
}

function RenameOrganizationForm({ organization }: OrganizationFormProperties) {
  const [result, setResult] = useState<CreateOrganizationResult>(emptyResult);
  const router = useRouter();
  const form = useForm({
    defaultValues: { organizationId: organization.id, name: organization.name },
    validators: { onSubmit: renameOrganizationSchema },
    onSubmit: async ({ value }) => {
      const actionResult = await renameOrganizationAction({ data: value });
      setResult(actionResult);

      if (actionResult.status === "success") {
        await router.invalidate();
      }
    },
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
    onSubmit: async ({ value }) => setResult(await deleteOrganizationAction({ data: value })),
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
