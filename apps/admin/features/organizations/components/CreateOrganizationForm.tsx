"use client";

import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import type { CreateOrganizationResult } from "@/features/organizations/actions/types";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createOrganizationAction } from "@/features/organizations/actions/createOrganization";
import { createOrganizationSchema } from "@/features/organizations/validation/createOrganization";

const initialResult: CreateOrganizationResult = {
  status: "success",
  message: "",
};

function CreateOrganizationForm() {
  const [result, setResult] = useState<CreateOrganizationResult>(initialResult);
  const form = useForm({
    defaultValues: {
      name: "",
    },
    validators: {
      onSubmit: createOrganizationSchema,
    },
    onSubmit: async ({ value }) => {
      const actionResult = await createOrganizationAction(value);
      setResult(actionResult);

      if (actionResult.status === "success") {
        form.reset();
      }
    },
  });
  const hasMessage = result.message.length > 0;

  return (
    <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
      <div className="mb-4">
        <h2 className="font-medium">Create organization</h2>
        <p className="text-sm text-muted-foreground">
          Add a Better Auth organization for Kira SaaS administration.
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
              const errors = field.state.meta.errors.flatMap((error) => {
                if (error === undefined) {
                  return [];
                }

                return [{ message: error.message }];
              });

              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>Organization name</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Kairos"
                    autoComplete="organization"
                    aria-invalid={isInvalid}
                    aria-describedby={hasMessage ? "create-organization-message" : undefined}
                  />
                  {isInvalid ? <FieldError errors={errors} /> : undefined}
                </Field>
              );
            }}
          </form.Field>
        </FieldGroup>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "Creating…" : "Create organization"}
            </Button>
          )}
        </form.Subscribe>
      </form>
      {hasMessage ? (
        <p
          id="create-organization-message"
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

export { CreateOrganizationForm };
