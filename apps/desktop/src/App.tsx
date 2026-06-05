import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/features/app-shell";
import { AppearanceThemeProvider, NotificationSettingsProvider } from "@/features/settings";

function App() {
  return (
    <AppearanceThemeProvider>
      <NotificationSettingsProvider>
        <AppShell />
        <Toaster />
      </NotificationSettingsProvider>
    </AppearanceThemeProvider>
  );
}

export default App;
