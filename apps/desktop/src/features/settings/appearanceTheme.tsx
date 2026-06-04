import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { AppearanceTheme } from "@/features/settings/types";

import { toast } from "@/components/ui/sonner";
import {
  getAppearanceSettings,
  updateAppearanceSettings,
} from "@/features/settings/api/settingsApi";

type AppearanceThemeContextValue = {
  theme: AppearanceTheme;
  status: "loading" | "ready" | "error";
  errorMessage: string | undefined;
  setTheme: (theme: AppearanceTheme) => Promise<void>;
};

type AppearanceThemeProviderProps = {
  children: ReactNode;
};

const defaultAppearanceTheme: AppearanceTheme = "dark";
const AppearanceThemeContext = createContext<AppearanceThemeContextValue | undefined>(undefined);

function AppearanceThemeProvider({ children }: AppearanceThemeProviderProps) {
  const [theme, setThemeState] = useState<AppearanceTheme>(defaultAppearanceTheme);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    applyAppearanceTheme(theme);
  }, [theme]);

  useEffect(() => {
    let ignoreResult = false;

    async function loadAppearanceTheme() {
      try {
        const settings = await getAppearanceSettings();
        if (ignoreResult) {
          return;
        }

        setThemeState(settings.theme);
        setStatus("ready");
        setErrorMessage(undefined);
      } catch (error) {
        if (ignoreResult) {
          return;
        }

        const message = errorMessageFromUnknown(error);
        setStatus("error");
        setErrorMessage(message);
        toast.error(`Appearance settings failed to load: ${message}`);
      }
    }

    void loadAppearanceTheme();

    return () => {
      ignoreResult = true;
    };
  }, []);

  const value = useMemo<AppearanceThemeContextValue>(
    () => ({
      theme,
      status,
      errorMessage,
      setTheme: async (nextTheme) => {
        const previousTheme = theme;
        setThemeState(nextTheme);

        try {
          const settings = await updateAppearanceSettings({ theme: nextTheme });
          setThemeState(settings.theme);
          setStatus("ready");
          setErrorMessage(undefined);
        } catch (error) {
          setThemeState(previousTheme);
          const message = errorMessageFromUnknown(error);
          setStatus("error");
          setErrorMessage(message);
          toast.error(`Appearance theme failed to save: ${message}`);
        }
      },
    }),
    [errorMessage, status, theme],
  );

  return (
    <AppearanceThemeContext.Provider value={value}>{children}</AppearanceThemeContext.Provider>
  );
}

function useAppearanceTheme() {
  const context = useContext(AppearanceThemeContext);
  if (context === undefined) {
    throw new Error("useAppearanceTheme must be used inside AppearanceThemeProvider");
  }

  return context;
}

function applyAppearanceTheme(theme: AppearanceTheme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function errorMessageFromUnknown(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}

export { AppearanceThemeProvider, useAppearanceTheme };
