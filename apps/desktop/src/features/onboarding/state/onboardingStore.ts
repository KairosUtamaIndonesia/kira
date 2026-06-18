import { create } from "zustand";

// Tracks whether the user has been through the quick-start wizard. Persisted in
// localStorage like the App Shell mode: it is a per-machine frontend preference,
// not durable app data. The wizard runs once on the very first desktop launch;
// logout/login does NOT retrigger it. "Replay quick start" in Settings flips
// `completed` back to false to show it again.

type OnboardingStoreState = {
  completed: boolean;
  complete: () => void;
  restart: () => void;
};

const onboardingStorageKey = "kira.onboarding-completed";

const useOnboardingStore = create<OnboardingStoreState>((set) => ({
  completed: localStorage.getItem(onboardingStorageKey) === "true",
  complete() {
    localStorage.setItem(onboardingStorageKey, "true");
    set({ completed: true });
  },
  restart() {
    localStorage.setItem(onboardingStorageKey, "false");
    set({ completed: false });
  },
}));

export { useOnboardingStore };
