import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { GuardrailsConfig } from "@/features/settings/types";

import { toast } from "@/components/ui/sonner";
import {
  getGuardrailsSettings,
  updateGuardrailsSettings,
} from "@/features/settings/api/settingsApi";

type GuardrailsSettingsStatus = "loading" | "ready" | "error";

type GuardrailsSettingsContextValue = {
  config: GuardrailsConfig | undefined;
  status: GuardrailsSettingsStatus;
  errorMessage: string | undefined;
  updateConfig: (next: GuardrailsConfig) => Promise<void>;
};

type GuardrailsSettingsProviderProps = {
  children: ReactNode;
};

const missingGuardrailsSettingsContext = Symbol("missing GuardrailsSettingsContext");
const GuardrailsSettingsContext = createContext<
  GuardrailsSettingsContextValue | typeof missingGuardrailsSettingsContext
>(missingGuardrailsSettingsContext);

function GuardrailsSettingsProvider({ children }: GuardrailsSettingsProviderProps) {
  const [config, setConfig] = useState<GuardrailsConfig | undefined>();
  const [status, setStatus] = useState<GuardrailsSettingsStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  useEffect(() => {
    let ignoreResult = false;

    async function loadGuardrailsSettings() {
      try {
        const loaded = await getGuardrailsSettings();
        if (ignoreResult) {
          return;
        }

        setConfig(loaded);
        setStatus("ready");
        setErrorMessage(undefined);
      } catch (error) {
        if (ignoreResult) {
          return;
        }

        const message = errorMessageFromUnknown(error);
        setStatus("error");
        setErrorMessage(message);
        toast.error(`Guardrails settings failed to load: ${message}`);
      }
    }

    void loadGuardrailsSettings();

    return () => {
      ignoreResult = true;
    };
  }, []);

  const value = useMemo<GuardrailsSettingsContextValue>(
    () => ({
      config,
      status,
      errorMessage,
      updateConfig: async (next) => {
        const previous = config;
        setConfig(next);

        try {
          const saved = await updateGuardrailsSettings(next);
          setConfig(saved);
          setStatus("ready");
          setErrorMessage(undefined);
        } catch (error) {
          setConfig(previous);
          const message = errorMessageFromUnknown(error);
          setStatus("error");
          setErrorMessage(message);
          toast.error(`Guardrails settings failed to save: ${message}`);
        }
      },
    }),
    [config, errorMessage, status],
  );

  return (
    <GuardrailsSettingsContext.Provider value={value}>
      {children}
    </GuardrailsSettingsContext.Provider>
  );
}

function useGuardrailsSettings() {
  const context = useContext(GuardrailsSettingsContext);
  if (context === missingGuardrailsSettingsContext) {
    throw new Error("useGuardrailsSettings must be used within a GuardrailsSettingsProvider");
  }

  return context;
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}

export { GuardrailsSettingsProvider, useGuardrailsSettings };
