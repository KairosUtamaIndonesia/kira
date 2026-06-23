import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import * as z from "zod";

import type { FetchProviderModelsInput } from "@/features/org-admin/providers/actions/fetchProviderModels";
import type { CreateOrganizationResult } from "@/features/organizations/actions/types";
import type { OrganizationProvider } from "@/features/organizations/types";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { testProviderConnectionAction } from "@/features/org-admin/providers/actions/fetchProviderModels";
import {
  createOrgProviderAction,
  updateOrgProviderAction,
} from "@/features/org-admin/providers/actions/manageProviders";
import { createOrganizationProviderSchema } from "@/features/organizations/validation/organizationProvider";

// Base schema without organizationId — matches the pattern in OrganizationModelForms
const providerFormSchema = createOrganizationProviderSchema.omit({ organizationId: true });

type ProviderFormValues = z.infer<typeof providerFormSchema>;

const emptyResult: CreateOrganizationResult = { status: "success", message: "" };

const blankProvider: ProviderFormValues = {
  label: "",
  providerId: "",
  providerBaseUrl: "",
  apiKey: undefined,
  modelsEndpoint: undefined,
};

function fieldErrors(errors: Array<{ message: string } | undefined>) {
  return errors.flatMap((error) => (error === undefined ? [] : [{ message: error.message }]));
}

type ProviderFormProperties = {
  organizationId: string;
  provider?: OrganizationProvider;
  onDone?: () => void;
};

function ProviderForm({ organizationId, provider, onDone }: ProviderFormProperties) {
  const router = useRouter();
  const [result, setResult] = useState<CreateOrganizationResult>(emptyResult);
  const [connectionResult, setConnectionResult] = useState<CreateOrganizationResult>();
  const [testing, setTesting] = useState(false);

  const defaultValues: ProviderFormValues =
    provider === undefined
      ? blankProvider
      : {
          label: provider.label,
          providerId: provider.providerId,
          providerBaseUrl: provider.providerBaseUrl,
          apiKey: provider.apiKey,
          modelsEndpoint: provider.modelsEndpoint,
        };

  const form = useForm({
    defaultValues,
    validators: { onSubmit: providerFormSchema },
    onSubmit: async ({ value }) => {
      const actionResult =
        provider === undefined
          ? await createOrgProviderAction({ data: { organizationId, ...value } })
          : await updateOrgProviderAction({
              data: { organizationId, id: provider.id, ...value },
            });
      setResult(actionResult);

      if (actionResult.status === "success") {
        if (provider === undefined) {
          form.reset();
        }

        if (onDone !== undefined) {
          onDone();
        }

        await router.invalidate();
      }
    },
  });

  const handleTestConnection = async () => {
    setTesting(true);
    setConnectionResult(undefined);

    const values = form.state.values;
    const input: FetchProviderModelsInput = {
      organizationId,
      providerBaseUrl: values.providerBaseUrl,
    };
    if (values.apiKey !== undefined) {
      input.apiKey = values.apiKey;
    }
    if (values.modelsEndpoint !== undefined) {
      input.modelsEndpoint = values.modelsEndpoint;
    }

    const testResult = await testProviderConnectionAction({ data: input });
    setConnectionResult(testResult);
    setTesting(false);
  };

  const hasMessage = result.message.length > 0;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <form.Field name="label">
          {(field) => (
            <Field data-invalid={field.state.meta.isTouched && !field.state.meta.isValid}>
              <FieldLabel htmlFor={field.name}>Label</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="Fast coding provider"
                aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
              />
              {field.state.meta.isTouched && !field.state.meta.isValid ? (
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              ) : undefined}
            </Field>
          )}
        </form.Field>
        <form.Field name="providerId">
          {(field) => (
            <Field data-invalid={field.state.meta.isTouched && !field.state.meta.isValid}>
              <FieldLabel htmlFor={field.name}>Provider ID</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="opencode-go"
                aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
              />
              {field.state.meta.isTouched && !field.state.meta.isValid ? (
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              ) : undefined}
            </Field>
          )}
        </form.Field>
        <form.Field name="providerBaseUrl">
          {(field) => (
            <Field data-invalid={field.state.meta.isTouched && !field.state.meta.isValid}>
              <FieldLabel htmlFor={field.name}>Base URL</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                type="url"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="https://api.example.com/v1"
                aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
              />
              {field.state.meta.isTouched && !field.state.meta.isValid ? (
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              ) : undefined}
            </Field>
          )}
        </form.Field>
        <form.Field name="apiKey">
          {(field) => (
            <Field data-invalid={field.state.meta.isTouched && !field.state.meta.isValid}>
              <FieldLabel htmlFor={field.name}>API Key</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                type="password"
                value={field.state.value ?? ""}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="Optional router auth key"
                aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
              />
              {field.state.meta.isTouched && !field.state.meta.isValid ? (
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              ) : undefined}
            </Field>
          )}
        </form.Field>
        <form.Field name="modelsEndpoint">
          {(field) => (
            <Field data-invalid={field.state.meta.isTouched && !field.state.meta.isValid}>
              <FieldLabel htmlFor={field.name}>Models endpoint</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value ?? ""}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="/models"
                aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
              />
              {field.state.meta.isTouched && !field.state.meta.isValid ? (
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              ) : undefined}
            </Field>
          )}
        </form.Field>
      </div>
      <div className="flex items-center gap-3">
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {provider === undefined ? "Add provider" : "Save changes"}
            </Button>
          )}
        </form.Subscribe>
        <Button type="button" variant="outline" disabled={testing} onClick={handleTestConnection}>
          {testing ? "Testing..." : "Test connection"}
        </Button>
        {connectionResult !== undefined ? (
          <span
            className={
              connectionResult.status === "error"
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
            }
            aria-live="polite"
          >
            {connectionResult.message}
          </span>
        ) : undefined}
        {hasMessage ? (
          <span
            className={
              result.status === "error"
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
            }
            aria-live="polite"
          >
            {result.message}
          </span>
        ) : undefined}
      </div>
    </form>
  );
}

export { ProviderForm };
