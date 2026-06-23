import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as z from "zod";

import type { ProviderModel } from "@/features/org-admin/providers/actions/fetchProviderModels";
import type { CreateOrganizationResult } from "@/features/organizations/actions/types";
import type { OrganizationModel, OrganizationProvider } from "@/features/organizations/types";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchProviderModelsAction } from "@/features/org-admin/providers/actions/fetchProviderModels";
import {
  getOrgProviderAction,
  listOrgProvidersAction,
} from "@/features/org-admin/providers/actions/manageProviders";
import {
  createOrganizationModelAction,
  deleteOrganizationModelAction,
  setDefaultOrganizationModelAction,
  updateOrganizationModelAction,
} from "@/features/organizations/actions/organizationModels";
import { organizationModelSchema } from "@/features/organizations/validation/organizationModel";

const emptyResult: CreateOrganizationResult = { status: "success", message: "" };

type ModelFormValues = z.infer<typeof organizationModelSchema>;

// Blank form state — providerBaseUrl and apiKey are NOT stored on the model;
// they are resolved from the provider row at query time (reference-based resolution).
const blankModel: ModelFormValues = {
  label: "",
  upstreamModelId: "",
  providerId: "",
  providerConfigId: "" as const,
  contextWindow: 0,
  maxOutputTokens: 0,
  maxInputTokens: undefined,
  isDefault: false,
  capabilities: undefined,
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

  // Provider-linked flow state
  const [providers, setProviders] = useState<Array<Omit<OrganizationProvider, "apiKey">>>([]);
  const [selectedProvider, setSelectedProvider] = useState<OrganizationProvider>();
  const [fetchedModels, setFetchedModels] = useState<ProviderModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [providersLoaded, setProvidersLoaded] = useState(false);

  // Load providers on mount
  useEffect(() => {
    (async () => {
      const fetchResult = await listOrgProvidersAction({ data: { organizationId } });
      if (fetchResult.status === "success") {
        setProviders(fetchResult.providers);

        // If editing, restore the selected provider
        if (model !== undefined && model.providerConfigId !== undefined) {
          const match = fetchResult.providers.find((p) => p.id === model.providerConfigId);
          if (match !== undefined) {
            // Fetch full provider data (with apiKey) for the edit session
            const full = await getOrgProviderAction({
              data: { organizationId, id: match.id },
            });
            if (full.status === "success") {
              setSelectedProvider(full.provider);
            }
          }
        }
      }
      setProvidersLoaded(true);
    })();
  }, [organizationId, model]);

  // When the user picks a provider, fetch full provider data (with apiKey)
  // so the model-discovery action can authenticate.
  const handleProviderSelect = async (providerId: string) => {
    const publicProvider = providers.find((p) => p.id === providerId);
    if (publicProvider === undefined) return;

    setSelectedModelId("");

    // Fetch full provider data including apiKey (never shipped in the list)
    const full = await getOrgProviderAction({
      data: { organizationId, id: publicProvider.id },
    });
    if (full.status === "success") {
      setSelectedProvider(full.provider);
    } else {
      // Fall back to public data (apiKey will be undefined — fetch may fail)
      setSelectedProvider({
        ...publicProvider,
        apiKey: undefined,
      });
    }
  };

  // Fetch models when the selected provider (with apiKey resolved) is set
  useEffect(() => {
    if (selectedProvider === undefined) {
      return;
    }

    let cancelled = false;
    setIsFetchingModels(true);
    setFetchedModels([]);
    setSelectedModelId("");

    (async () => {
      const provider = selectedProvider;
      const fetchResult = await fetchProviderModelsAction({
        data: {
          organizationId,
          providerBaseUrl: provider.providerBaseUrl,
          apiKey: provider.apiKey ?? "",
          modelsEndpoint: provider.modelsEndpoint ?? "",
        },
      });
      if (!cancelled) {
        if (fetchResult.status === "success") {
          setFetchedModels(fetchResult.models);

          // Pre-select model when editing a provider-linked model
          if (model !== undefined && model.providerConfigId !== undefined) {
            const match = fetchResult.models.find((m) => m.id === model.upstreamModelId);
            if (match !== undefined) {
              setSelectedModelId(match.id);
            }
          }
        }
        setIsFetchingModels(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId, selectedProvider, model]);

  const defaultValues: ModelFormValues =
    model === undefined
      ? blankModel
      : {
          label: model.label,
          upstreamModelId: model.upstreamModelId,
          providerId: model.providerId,
          providerConfigId: model.providerConfigId,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutputTokens,
          maxInputTokens: model.maxInputTokens,
          isDefault: model.isDefault,
          capabilities: model.capabilities,
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

  function handleModelSelect(modelId: string | null) {
    if (modelId === null) return;
    if (selectedProvider === undefined) return;
    setSelectedModelId(modelId);
    const fetchedModel = fetchedModels.find((m) => m.id === modelId);
    if (fetchedModel === undefined) {
      return;
    }
    form.setFieldValue("upstreamModelId", fetchedModel.id);
    form.setFieldValue("label", fetchedModel.name);
    form.setFieldValue("contextWindow", fetchedModel.context_length ?? 0);
    form.setFieldValue("maxOutputTokens", fetchedModel.max_output_tokens ?? 0);
    form.setFieldValue("capabilities", fetchedModel.capabilities);
    form.setFieldValue("providerConfigId", selectedProvider.id);
    form.setFieldValue("providerId", selectedProvider.providerId);
  }

  // Build provider picker content without nested ternaries
  let providerPickerContent: React.ReactNode;
  if (!providersLoaded) {
    providerPickerContent = <p className="text-sm text-muted-foreground">Loading providers...</p>;
  } else if (providers.length === 0) {
    providerPickerContent = (
      <p className="text-sm text-muted-foreground">
        No providers registered. Add a provider first.
      </p>
    );
  } else {
    providerPickerContent = (
      <Field>
        <FieldLabel htmlFor="provider-select">Provider</FieldLabel>
        <Select
          value={selectedProvider !== undefined ? selectedProvider.id : ""}
          onValueChange={(value: string | null) => {
            if (value === null) return;
            handleProviderSelect(value);
          }}
        >
          <SelectTrigger id="provider-select">
            <SelectValue placeholder="Select a provider...">
              {(value: string | null) => {
                if (value === null || value === "") return "Select a provider...";
                const p = providers.find((prov) => prov.id === value);
                return p !== undefined ? `${p.label} (${p.providerId})` : value;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label} ({p.providerId})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    );
  }

  // Build model picker content without nested ternaries
  let modelPickerContent: React.ReactNode;
  if (selectedProvider === undefined) {
    modelPickerContent = undefined;
  } else if (isFetchingModels) {
    modelPickerContent = <p className="text-sm text-muted-foreground">Loading models...</p>;
  } else if (fetchedModels.length === 0) {
    modelPickerContent = <p className="text-sm text-muted-foreground">No models available.</p>;
  } else {
    modelPickerContent = (
      <Field>
        <FieldLabel htmlFor="model-select">Model</FieldLabel>
        <Select value={selectedModelId} onValueChange={handleModelSelect}>
          <SelectTrigger id="model-select">
            <SelectValue placeholder="Select a model...">
              {(value: string | null) => {
                if (value === null || value === "") return "Select a model...";
                const m = fetchedModels.find((fetched) => fetched.id === value);
                return m !== undefined ? `${m.name} (${m.id})` : value;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {fetchedModels.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name} ({m.id})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      {/* Step 1: Pick a provider */}
      <div>{providerPickerContent}</div>

      {/* Step 2: Pick a model */}
      {modelPickerContent !== undefined ? <div>{modelPickerContent}</div> : undefined}

      {/* Step 3: Editable override fields */}
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
            aria-live="polite"
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
