import { Toaster } from "@/components/ui/sonner";
import { Shell } from "@/features/app-shell";
import { SignInGate } from "@/features/desktop-auth";
import {
  AppearanceThemeProvider,
  NotificationSettingsProvider,
  TerminalSettingsProvider,
} from "@/features/settings";
import { UpdateChecker } from "@/features/updater";

function App() {
  return (
    <AppearanceThemeProvider>
      <NotificationSettingsProvider>
        <TerminalSettingsProvider>
          <SignInGate>
            <Shell />
            <UpdateChecker />
          </SignInGate>
          <Toaster />
        </TerminalSettingsProvider>
      </NotificationSettingsProvider>
    </AppearanceThemeProvider>
  );
}

export default App;
