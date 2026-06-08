import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/features/app-shell";
import { AppearanceThemeProvider, NotificationSettingsProvider } from "@/features/settings";
import { UpdateChecker } from "@/features/updater";

function App() {
  return (
    <AppearanceThemeProvider>
      <NotificationSettingsProvider>
        <AppShell />
        <UpdateChecker />
        <Toaster />
      </NotificationSettingsProvider>
    </AppearanceThemeProvider>
  );
}

export default App;
