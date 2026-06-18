import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { CreateOrganizationResult } from "@/features/organizations/actions/types";
import type { OrganizationModel } from "@/features/organizations/types";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  createOrganizationModelAction,
  deleteOrganizationModelAction,
  setDefaultOrganizationModelAction,
  updateOrganizationModelAction,
} from "@/features/organizations/actions/organizationModels";
import { organizationModelSchema } from "@/features/organizations/validation/organizationModel";

const emptyResult: CreateOrganizationResult = { status: "success", message: "" };

type ModelFormValues = {
  label: string;
  upstreamModelId: string;
  providerId: string;
  providerBaseUrl: string;
  contextWindow: number;
  maxOutputTokens: number;
  isDefault: boolean;
  apiKey: string | undefined;
};

const blankModel: ModelFormValues = {
  label: "",
  upstreamModelId: "",
  providerId: "",
  providerBaseUrl: "",
  contextWindow: 0,
  maxOutputTokens: 0,
  isDefault: false,
  apiKey: undefined,
};

function fieldErrors(errors: Array<{ message: string } | undefined>) {
  return errors.flatMap((error) => (error === undefined ? [] : [{ message: error.message }]));
}

type LabeledInputProperties = {
  name: string;
  label: string;
  value: string;
  invalid: boolean;
  errors: Array<{ message: string } | undefined>;
  onBlur: () => void;
  onChange: (value: string) => void;
  type?: string;
  inputMode?: "numeric";
  placeholder?: string;
};

function LabeledInput(properties: LabeledInputProperties) {
  return (
    <Field data-invalid={properties.invalid}>
      <FieldLabel htmlFor={properties.name}>{properties.label}</FieldLabel>
      <Input
        id={properties.name}
        name={properties.name}
        value={properties.value}
        type={properties.type}
        inputMode={properties.inputMode}
        placeholder={properties.placeholder}
        onBlur={properties.onBlur}
        onChange={(event) => properties.onChange(event.target.value)}
        aria-invalid={properties.invalid}
      />
      {properties.invalid ? <FieldError errors={fieldErrors(properties.errors)} /> : undefined}
    </Field>
  );
}

function numberInputValue(value: number) {
  return Number.isNaN(value) ? "" : String(value);
}

type ModelFormProperties = {
  organizationId: string;
  model?: OrganizationModel;
  onDone?: () => void;
};

function ModelForm({ organizationId, model, onDone }: ModelFormProperties) {
  const router = useRouter();
  const [result, setResult] = useState<CreateOrganizationResult>(emptyResult);
  const defaultValues: ModelFormValues =
    model === undefined
      ? blankModel
      : {
          label: model.label,
          upstreamModelId: model.upstreamModelId,
          providerId: model.providerId,
          providerBaseUrl: model.providerBaseUrl,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutputTokens,
          isDefault: model.isDefault,
          apiKey: model.apiKey,
        };

  const form = useForm({
    defaultValues,
    validators: { onSubmit: organizationModelSchema },
    onSubmit: async ({ value }) => {
      const actionResult =
        model === undefined
          ? await createOrganizationModelAction({ data: { organizationId, ...value } })
          : await updateOrganizationModelAction({
              data: { organizationId, modelId: model.id, ...value },
            });
      setResult(actionResult);

      if (actionResult.status === "success") {
        if (model === undefined) {
          form.reset();
        }

        if (onDone !== undefined) {
          onDone();
        }

        await router.invalidate();
      }
    },
  });
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
            <LabeledInput
              name={field.name}
              label="Label"
              value={field.state.value}
              invalid={field.state.meta.isTouched && !field.state.meta.isValid}
              errors={field.state.meta.errors}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              placeholder="Fast coding model"
            />
          )}
        </form.Field>
        <form.Field name="upstreamModelId">
          {(field) => (
            <LabeledInput
              name={field.name}
              label="Model ID"
              value={field.state.value}
              invalid={field.state.meta.isTouched && !field.state.meta.isValid}
              errors={field.state.meta.errors}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              placeholder="gh/gpt-5.5"
            />
          )}
        </form.Field>
        <form.Field name="providerId">
          {(field) => (
            <LabeledInput
              name={field.name}
              label="Provider ID"
              value={field.state.value}
              invalid={field.state.meta.isTouched && !field.state.meta.isValid}
              errors={field.state.meta.errors}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              placeholder="github-copilot"
            />
          )}
        </form.Field>
        <form.Field name="providerBaseUrl">
          {(field) => (
            <LabeledInput
              name={field.name}
              label="Provider base URL"
              type="url"
              value={field.state.value}
              invalid={field.state.meta.isTouched && !field.state.meta.isValid}
              errors={field.state.meta.errors}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              placeholder="https://api.example.com/v1"
            />
          )}
        </form.Field>
        <form.Field name="contextWindow">
          {(field) => (
            <LabeledInput
              name={field.name}
              label="Context window"
              type="number"
              inputMode="numeric"
              value={numberInputValue(field.state.value)}
              invalid={field.state.meta.isTouched && !field.state.meta.isValid}
              errors={field.state.meta.errors}
              onBlur={field.handleBlur}
              onChange={(value) => field.handleChange(value === "" ? Number.NaN : Number(value))}
              placeholder="200000"
            />
          )}
        </form.Field>
        <form.Field name="maxOutputTokens">
          {(field) => (
            <LabeledInput
              name={field.name}
              label="Max output tokens"
              type="number"
              inputMode="numeric"
              value={numberInputValue(field.state.value)}
              invalid={field.state.meta.isTouched && !field.state.meta.isValid}
              errors={field.state.meta.errors}
              onBlur={field.handleBlur}
              onChange={(value) => field.handleChange(value === "" ? Number.NaN : Number(value))}
              placeholder="64000"
            />
          )}
        </form.Field>
        <form.Field name="apiKey">
          {(field) => (
            <LabeledInput
              name={field.name}
              label="API key"
              type="password"
              value={field.state.value ?? ""}
              invalid={field.state.meta.isTouched && !field.state.meta.isValid}
              errors={field.state.meta.errors}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              placeholder="Optional router auth key"
            />
          )}
        </form.Field>
      </div>
      <form.Field name="isDefault">
        {(field) => (
          <Field orientation="horizontal">
            <input
              id={field.name}
              name={field.name}
              type="checkbox"
              aria-label="Use as the default model"
              checked={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.checked)}
              className="size-4 rounded border-input accent-primary"
            />
            <FieldLabel htmlFor={field.name}>Use as the default model</FieldLabel>
          </Field>
        )}
      </form.Field>
      <div className="flex items-center gap-3">
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {model === undefined ? "Add model" : "Save changes"}
            </Button>
          )}
        </form.Subscribe>
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

type ModelActionsProperties = {
  model: OrganizationModel;
};

function ModelActions({ model }: ModelActionsProperties) {
  const router = useRouter();
  const [result, setResult] = useState<CreateOrganizationResult>(emptyResult);
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {model.isDefault ? undefined : (
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              const actionResult = await setDefaultOrganizationModelAction({
                data: {
                  organizationId: model.organizationId,
                  modelId: model.id,
                },
              });
              setResult(actionResult);

              if (actionResult.status === "success") {
                await router.invalidate();
              }
            }}
          >
            Set default
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => setIsEditing((value) => !value)}>
          {isEditing ? "Cancel" : "Edit"}
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={async () => {
            const actionResult = await deleteOrganizationModelAction({
              data: {
                organizationId: model.organizationId,
                modelId: model.id,
              },
            });
            setResult(actionResult);

            if (actionResult.status === "success") {
              await router.invalidate();
            }
          }}
        >
          Delete
        </Button>
        {result.message.length > 0 ? (
          <span
            className={
              result.status === "error"
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
            }
          >
            {result.message}
          </span>
        ) : undefined}
      </div>
      {isEditing ? (
        <ModelForm
          organizationId={model.organizationId}
          model={model}
          onDone={() => setIsEditing(false)}
        />
      ) : undefined}
    </div>
  );
}

export { ModelActions, ModelForm };
