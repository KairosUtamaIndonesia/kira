import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/features/app-shell";
import { SignInGate } from "@/features/desktop-auth";
import { AppearanceThemeProvider, NotificationSettingsProvider } from "@/features/settings";
import { UpdateChecker } from "@/features/updater";

function App() {
  return (
    <AppearanceThemeProvider>
      <NotificationSettingsProvider>
        <SignInGate>
          <AppShell />
          <UpdateChecker />
        </SignInGate>
        <Toaster />
      </NotificationSettingsProvider>
    </AppearanceThemeProvider>
  );
}

export default App;
