import { create } from "zustand";

// The App Shell renders one of two layouts ("shells") for the same app data:
// `code` is the developer layout (sidebar + workspace + inspector), `cowork`
// is the chat-first layout for non-developers. Persisted per user in
// localStorage; the data model underneath is identical in both modes.

type AppShellMode = "code" | "cowork";

type ModeStoreState = {
  mode: AppShellMode;
  setMode: (mode: AppShellMode) => void;
  toggleMode: () => void;
};

const modeStorageKey = "kira.app-shell.mode";

function persistedMode(): AppShellMode {
  const storedMode = localStorage.getItem(modeStorageKey);
  if (storedMode === "code" || storedMode === "cowork") {
    return storedMode;
  }

  // First launch (or an unrecognized stored value): the developer layout is
  // the product default.
  return "code";
}

const useModeStore = create<ModeStoreState>((set, get) => ({
  mode: persistedMode(),
  setMode(mode) {
    localStorage.setItem(modeStorageKey, mode);
    set({ mode });
  },
  toggleMode() {
    const nextMode: AppShellMode = get().mode === "code" ? "cowork" : "code";
    get().setMode(nextMode);
  },
}));

const appShellModeLabels: Record<AppShellMode, string> = {
  code: "Code",
  cowork: "Cowork",
};

export { appShellModeLabels, useModeStore };
export type { AppShellMode };
