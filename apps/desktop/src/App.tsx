import { Toaster } from "@/components/ui/sonner";
import { Shell } from "@/features/app-shell";
import { SignInGate } from "@/features/desktop-auth";
import {
  AppearanceThemeProvider,
  GuardrailsSettingsProvider,
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
            <SignInGate>
              <Shell />
              <UpdateChecker />
            </SignInGate>
            <Toaster />
          </GuardrailsSettingsProvider>
        </TerminalSettingsProvider>
      </NotificationSettingsProvider>
    </AppearanceThemeProvider>
  );
}

export default App;
