import { Music, Pause, Play, Trash2, Upload } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

import type { NotificationSound } from "@/features/settings/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNotificationSettings } from "@/features/settings/notificationSettings";

function NotificationSettings() {
  const {
    errorMessage,
    importCustomSound,
    playingSoundId,
    previewSound,
    removeCustomSound,
    selectSound,
    selectedSound,
    setEnabled,
    settings,
    setVolume,
    status,
  } = useNotificationSettings();
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function importFirstFile(files: FileList) {
    const file = files.item(0);
    if (file === null) {
      return;
    }

    await importCustomSound(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingFile(false);
    void importFirstFile(event.dataTransfer.files);
  }

  return (
    <section className="rounded-xl border border-border bg-card text-card-foreground">
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-medium">Notifications</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how Kira plays notification sounds.
        </p>
      </div>
      <div className="grid gap-5 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Sound notifications</h3>
            <p className="text-xs text-muted-foreground">Play sounds for important Kira events.</p>
          </div>
          <Button
            type="button"
            variant={settings.enabled ? "default" : "outline"}
            aria-pressed={settings.enabled}
            disabled={status === "loading"}
            onClick={() => {
              void setEnabled(!settings.enabled);
            }}
          >
            {settings.enabled ? "Sounds on" : "Sounds off"}
          </Button>
        </div>

        <div className="border-t border-border pt-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium">Notification volume</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Set how loud notification sounds play.
                </p>
              </div>
              <output className="text-xs font-medium text-muted-foreground">
                {Math.round(settings.volume * 100)}%
              </output>
            </div>
            <Input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.volume}
              disabled={status === "loading"}
              aria-label="Notification volume"
              className="px-0"
              onChange={(event) => {
                void setVolume(event.currentTarget.valueAsNumber);
              }}
            />
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <SoundGroup
            title="Built-in sounds"
            description="Bundled from Orca for Kira notifications."
            sounds={settings.bundledSounds}
            selectedSoundId={selectedSound.id}
            playingSoundId={playingSoundId}
            disabled={status === "loading"}
            onPreview={previewSound}
            onSelect={selectSound}
          />
        </div>

        <div className="border-t border-border pt-4">
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">Custom sounds</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Drop in an audio file to copy it into Kira's app data folder.
              </p>
            </div>
            <div
              className="rounded-xl border border-dashed border-border bg-background p-4"
              data-current={isDraggingFile}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDraggingFile(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDragLeave={() => setIsDraggingFile(false)}
              onDrop={handleDrop}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg border border-border bg-card p-2 text-muted-foreground">
                    <Upload aria-hidden="true" className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Drop an audio file here</p>
                    <p className="text-xs text-muted-foreground">MP3, WAV, OGG, FLAC, or M4A.</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={status === "loading"}
                  onClick={() => {
                    if (inputRef.current === null) {
                      throw new Error("Notification sound file input is not mounted");
                    }

                    inputRef.current.click();
                  }}
                >
                  Choose file
                </Button>
              </div>
              <Input
                ref={inputRef}
                type="file"
                accept="audio/*"
                className="sr-only"
                onChange={(event) => {
                  if (event.currentTarget.files !== null) {
                    void importFirstFile(event.currentTarget.files);
                  }
                  event.currentTarget.value = "";
                }}
              />
            </div>

            {settings.customSounds.length === 0 ? (
              <p className="text-xs text-muted-foreground">No custom sounds imported yet.</p>
            ) : (
              <div className="grid gap-2">
                {settings.customSounds.map((sound) => (
                  <SoundRow
                    key={sound.id}
                    sound={sound}
                    isSelected={selectedSound.id === sound.id}
                    isPlaying={playingSoundId === sound.id}
                    disabled={status === "loading"}
                    onPreview={previewSound}
                    onSelect={selectSound}
                    onRemove={removeCustomSound}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {status === "error" ? (
          <p className="text-xs text-destructive">Notification settings failed: {errorMessage}</p>
        ) : undefined}
      </div>
    </section>
  );
}

type SoundGroupProps = {
  title: string;
  description: string;
  sounds: readonly NotificationSound[];
  selectedSoundId: string;
  playingSoundId: string | undefined;
  disabled: boolean;
  onPreview: (sound: NotificationSound) => Promise<void>;
  onSelect: (soundId: string) => Promise<void>;
};

function SoundGroup({
  title,
  description,
  sounds,
  selectedSoundId,
  playingSoundId,
  disabled,
  onPreview,
  onSelect,
}: SoundGroupProps) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {sounds.map((sound) => (
          <SoundRow
            key={sound.id}
            sound={sound}
            isSelected={selectedSoundId === sound.id}
            isPlaying={playingSoundId === sound.id}
            disabled={disabled}
            onPreview={onPreview}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

type SoundRowProps = {
  sound: NotificationSound;
  isSelected: boolean;
  isPlaying: boolean;
  disabled: boolean;
  onPreview: (sound: NotificationSound) => Promise<void>;
  onSelect: (soundId: string) => Promise<void>;
  onRemove?: (soundId: string) => Promise<void>;
};

function SoundRow({
  sound,
  isSelected,
  isPlaying,
  disabled,
  onPreview,
  onSelect,
  onRemove,
}: SoundRowProps) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3"
      data-current={isSelected}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-pressed={isSelected}
        disabled={disabled}
        onClick={() => {
          void onSelect(sound.id);
        }}
      >
        <Music aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{sound.label}</span>
          <span className="block text-xs text-muted-foreground">
            {sound.kind === "custom" ? "Custom sound" : "Built-in sound"}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={isPlaying ? `${sound.label} is playing` : `Preview ${sound.label}`}
          aria-live="polite"
          disabled={disabled}
          onClick={() => {
            void onPreview(sound);
          }}
        >
          <span className="kira-icon-swap" data-state={isPlaying ? "playing" : "idle"}>
            <Play aria-hidden="true" className="kira-icon-swap__icon" data-icon="idle" />
            <Pause aria-hidden="true" className="kira-icon-swap__icon" data-icon="playing" />
          </span>
        </Button>
        {onRemove === undefined ? undefined : (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${sound.label}`}
            disabled={disabled}
            onClick={() => {
              void onRemove(sound.id);
            }}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

export { NotificationSettings };
