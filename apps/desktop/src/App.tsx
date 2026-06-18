import { Toaster } from "@/components/ui/sonner";
import { Shell } from "@/features/app-shell";
import { SignInGate } from "@/features/desktop-auth";
import { OnboardingWizard } from "@/features/onboarding";
import {
  AppearanceThemeProvider,
  GuardrailsSettingsProvider,
  MemorySettingsProvider,
  NotificationSettingsProvider,
  TerminalSettingsProvider,
} from "@/features/settings";
import { UpdateChecker } from "@/features/updater";

function App() {
  return (
    <AppearanceThemeProvider>
      <NotificationSettingsProvider>
        <TerminalSettingsProvider>
          <GuardrailsSettingsProvider>
            <MemorySettingsProvider>
              <SignInGate>
                <Shell />
                <OnboardingWizard />
                <UpdateChecker />
              </SignInGate>
              <Toaster />
            </MemorySettingsProvider>
          </GuardrailsSettingsProvider>
        </TerminalSettingsProvider>
      </NotificationSettingsProvider>
    </AppearanceThemeProvider>
  );
}

export default App;
