import { Moon, Sun } from "lucide-react";

import { useAppearanceTheme } from "@/features/settings";

import { ChoiceCard } from "../ChoiceCard";

// Step 3 (final): pick light or dark. Selecting persists through the appearance
// settings provider, which applies the theme to the document immediately.
function ThemeStep() {
  const { theme, setTheme } = useAppearanceTheme();

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ChoiceCard
        selected={theme === "light"}
        onSelect={() => void setTheme("light")}
        icon={<Sun className="size-5" aria-hidden="true" />}
        title="Light"
        description="Bright surfaces for well-lit rooms."
      />
      <ChoiceCard
        selected={theme === "dark"}
        onSelect={() => void setTheme("dark")}
        icon={<Moon className="size-5" aria-hidden="true" />}
        title="Dark"
        description="Dim surfaces that stay easy on the eyes at night."
      />
    </div>
  );
}

export { ThemeStep };
