import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/features/app-shell";
import { AppearanceThemeProvider } from "@/features/settings";

function App() {
  return (
    <AppearanceThemeProvider>
      <AppShell />
      <Toaster />
    </AppearanceThemeProvider>
  );
}

export default App;
