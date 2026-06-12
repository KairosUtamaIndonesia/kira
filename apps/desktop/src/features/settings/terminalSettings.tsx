import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { toast } from "@/components/ui/sonner";
import { getTerminalSettings, updateTerminalSettings } from "@/features/settings/api/settingsApi";

type TerminalSettingsContextValue = {
  shellPath: string | undefined;
  terminalShellPath: string | undefined;
  status: "loading" | "ready" | "error";
  errorMessage: string | undefined;
  setShellPath: (path: string | undefined) => Promise<void>;
  setTerminalShellPath: (path: string | undefined) => Promise<void>;
};

type TerminalSettingsProviderProps = {
  children: ReactNode;
};

const missingTerminalSettingsContext = Symbol("missing TerminalSettingsContext");
const TerminalSettingsContext = createContext<
  TerminalSettingsContextValue | typeof missingTerminalSettingsContext
>(missingTerminalSettingsContext);

function TerminalSettingsProvider({ children }: TerminalSettingsProviderProps) {
  const [shellPath, setShellPathState] = useState<string | undefined>();
  const [terminalShellPath, setTerminalShellPathState] = useState<string | undefined>();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  useEffect(() => {
    let ignoreResult = false;

    async function loadTerminalSettings() {
      try {
        const settings = await getTerminalSettings();
        if (ignoreResult) {
          return;
        }

        setShellPathState(settings.shellPath);
        setTerminalShellPathState(settings.terminalShellPath);
        setStatus("ready");
        setErrorMessage(undefined);
      } catch (error) {
        if (ignoreResult) {
          return;
        }

        const message = errorMessageFromUnknown(error);
        setStatus("error");
        setErrorMessage(message);
        toast.error(`Terminal settings failed to load: ${message}`);
      }
    }

    void loadTerminalSettings();

    return () => {
      ignoreResult = true;
    };
  }, []);

  const value = useMemo<TerminalSettingsContextValue>(
    () => ({
      shellPath,
      terminalShellPath,
      status,
      errorMessage,
      setShellPath: async (nextShellPath) => {
        const previousShellPath = shellPath;
        setShellPathState(nextShellPath);

        try {
          const settings = await updateTerminalSettings({
            shellPath: nextShellPath,
            terminalShellPath,
          });
          setShellPathState(settings.shellPath);
          setTerminalShellPathState(settings.terminalShellPath);
          setStatus("ready");
          setErrorMessage(undefined);
        } catch (error) {
          setShellPathState(previousShellPath);
          const message = errorMessageFromUnknown(error);
          setStatus("error");
          setErrorMessage(message);
          toast.error(`Shell path failed to save: ${message}`);
        }
      },
      setTerminalShellPath: async (nextTerminalShellPath) => {
        const previousTerminalShellPath = terminalShellPath;
        setTerminalShellPathState(nextTerminalShellPath);

        try {
          const settings = await updateTerminalSettings({
            shellPath,
            terminalShellPath: nextTerminalShellPath,
          });
          setShellPathState(settings.shellPath);
          setTerminalShellPathState(settings.terminalShellPath);
          setStatus("ready");
          setErrorMessage(undefined);
        } catch (error) {
          setTerminalShellPathState(previousTerminalShellPath);
          const message = errorMessageFromUnknown(error);
          setStatus("error");
          setErrorMessage(message);
          toast.error(`Terminal shell path failed to save: ${message}`);
        }
      },
    }),
    [errorMessage, shellPath, status, terminalShellPath],
  );

  return (
    <TerminalSettingsContext.Provider value={value}>{children}</TerminalSettingsContext.Provider>
  );
}

function useTerminalSettings() {
  const context = useContext(TerminalSettingsContext);
  if (context === missingTerminalSettingsContext) {
    throw new Error("useTerminalSettings must be used within a TerminalSettingsProvider");
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

  return "An unknown error occurred";
}

export { TerminalSettingsProvider, useTerminalSettings };
