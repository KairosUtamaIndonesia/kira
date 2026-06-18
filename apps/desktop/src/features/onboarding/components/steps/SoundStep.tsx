import { Music, Pause, Play } from "lucide-react";

import type { NotificationSound } from "@/features/settings/types";

import { Button } from "@/components/ui/button";
import { useNotificationSettings } from "@/features/settings";

// A curated subset of the bundled sounds so the wizard stays light; the full set,
// custom imports, and volume live in Settings → Notifications.
const curatedSoundIds = new Set<string>([
  "bundled:ding",
  "bundled:blip",
  "bundled:bong",
  "bundled:sonar",
  "bundled:two-tone",
]);

// Step 2: pick the notification sound Kira plays when an agent finishes or needs
// the user. Selecting and previewing go through the existing notification settings
// provider, which persists the choice to the backend.
function SoundStep() {
  const { settings, selectedSound, playingSoundId, selectSound, previewSound } =
    useNotificationSettings();

  const curatedSounds = settings.bundledSounds.filter((sound) => curatedSoundIds.has(sound.id));

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {curatedSounds.map((sound) => (
          <SoundChoiceRow
            key={sound.id}
            sound={sound}
            isSelected={selectedSound.id === sound.id}
            isPlaying={playingSoundId === sound.id}
            onSelect={selectSound}
            onPreview={previewSound}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        More sounds, custom imports, and volume live in Settings → Notifications.
      </p>
    </div>
  );
}

type SoundChoiceRowProps = {
  sound: NotificationSound;
  isSelected: boolean;
  isPlaying: boolean;
  onSelect: (soundId: string) => Promise<void>;
  onPreview: (sound: NotificationSound) => Promise<void>;
};

function SoundChoiceRow({
  sound,
  isSelected,
  isPlaying,
  onSelect,
  onPreview,
}: SoundChoiceRowProps) {
  return (
    <div
      className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3 data-[current=true]:border-ring"
      data-current={isSelected}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-pressed={isSelected}
        onClick={() => {
          void onSelect(sound.id);
        }}
      >
        <Music
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground group-data-[current=true]:text-foreground"
        />
        <span className="block truncate text-sm font-medium">{sound.label}</span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={isPlaying ? `${sound.label} is playing` : `Preview ${sound.label}`}
        aria-live="polite"
        onClick={() => {
          void onPreview(sound);
        }}
      >
        <span className="kira-icon-swap" data-state={isPlaying ? "playing" : "idle"}>
          <Play aria-hidden="true" className="kira-icon-swap__icon" data-icon="idle" />
          <Pause aria-hidden="true" className="kira-icon-swap__icon" data-icon="playing" />
        </span>
      </Button>
    </div>
  );
}

export { SoundStep };
