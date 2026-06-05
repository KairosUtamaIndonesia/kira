import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";

import type {
  BundledNotificationSound,
  NotificationSettings,
  NotificationSettingsUpdateInput,
  NotificationSound,
} from "@/features/settings/types";

import { toast } from "@/components/ui/sonner";
import {
  getNotificationSettings,
  importNotificationSound,
  readNotificationSound,
  removeNotificationSound,
  updateNotificationSettings,
} from "@/features/settings/api/settingsApi";

type NotificationSettingsStatus = "loading" | "ready" | "error";

type NotificationSettingsContextValue = {
  settings: NotificationSettings;
  status: NotificationSettingsStatus;
  errorMessage: string | undefined;
  selectedSound: NotificationSound;
  playingSoundId: string | undefined;
  setEnabled: (enabled: boolean) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  selectSound: (soundId: string) => Promise<void>;
  importCustomSound: (file: File) => Promise<void>;
  removeCustomSound: (soundId: string) => Promise<void>;
  previewSound: (sound: NotificationSound) => Promise<void>;
};

type NotificationSettingsProviderProps = {
  children: ReactNode;
};

const bundledNotificationSounds: readonly BundledNotificationSound[] = [
  { id: "bundled:beep", label: "Beep", kind: "bundled", url: "/notification-sounds/beep.mp3" },
  { id: "bundled:blip", label: "Blip", kind: "bundled", url: "/notification-sounds/blip.mp3" },
  { id: "bundled:blop", label: "Blop", kind: "bundled", url: "/notification-sounds/blop.mp3" },
  { id: "bundled:bong", label: "Bong", kind: "bundled", url: "/notification-sounds/bong.mp3" },
  { id: "bundled:clack", label: "Clack", kind: "bundled", url: "/notification-sounds/clack.mp3" },
  { id: "bundled:ding", label: "Ding", kind: "bundled", url: "/notification-sounds/ding.mp3" },
  { id: "bundled:sonar", label: "Sonar", kind: "bundled", url: "/notification-sounds/sonar.mp3" },
  { id: "bundled:thump", label: "Thump", kind: "bundled", url: "/notification-sounds/thump.mp3" },
  {
    id: "bundled:two-tone",
    label: "Two-tone",
    kind: "bundled",
    url: "/notification-sounds/two-tone.mp3",
  },
];

const defaultNotificationSettings: NotificationSettings = {
  enabled: true,
  volume: 0.8,
  selectedSoundId: "bundled:ding",
  bundledSounds: bundledNotificationSounds,
  customSounds: [],
};

const missingNotificationSettingsContext = Symbol("missing NotificationSettingsContext");
const NotificationSettingsContext = createContext<
  NotificationSettingsContextValue | typeof missingNotificationSettingsContext
>(missingNotificationSettingsContext);

function NotificationSettingsProvider({ children }: NotificationSettingsProviderProps) {
  const [settings, setSettings] = useState<NotificationSettings>(defaultNotificationSettings);
  const [status, setStatus] = useState<NotificationSettingsStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [playingSoundId, setPlayingSoundId] = useState<string | undefined>();
  const audioRef = useRef<HTMLAudioElement | undefined>(void 0);

  useEffect(() => {
    let ignoreResult = false;

    async function loadNotificationSettings() {
      try {
        const loadedSettings = await getNotificationSettings();
        if (ignoreResult) {
          return;
        }

        setSettings(withBundledSounds(loadedSettings));
        setStatus("ready");
        setErrorMessage(undefined);
      } catch (error) {
        if (ignoreResult) {
          return;
        }

        const message = errorMessageFromUnknown(error);
        setStatus("error");
        setErrorMessage(message);
        toast.error(`Notification settings failed to load: ${message}`);
      }
    }

    void loadNotificationSettings();

    return () => {
      ignoreResult = true;
    };
  }, []);

  const selectedSound = selectedSoundFromSettings(settings);

  const saveSettings = useCallback(
    async (input: NotificationSettingsUpdateInput) => {
      const previousSettings = settings;
      const optimisticSettings = withBundledSounds({ ...settings, ...input });
      setSettings(optimisticSettings);

      try {
        const savedSettings = await updateNotificationSettings(input);
        setSettings(withBundledSounds(savedSettings));
        setStatus("ready");
        setErrorMessage(undefined);
      } catch (error) {
        setSettings(previousSettings);
        const message = errorMessageFromUnknown(error);
        setStatus("error");
        setErrorMessage(message);
        toast.error(`Notification settings failed to save: ${message}`);
      }
    },
    [settings],
  );

  const value = useMemo<NotificationSettingsContextValue>(
    () => ({
      settings,
      status,
      errorMessage,
      selectedSound,
      playingSoundId,
      setEnabled: async (enabled) => {
        await saveSettings({
          enabled,
          volume: settings.volume,
          selectedSoundId: settings.selectedSoundId,
        });
      },
      setVolume: async (volume) => {
        await saveSettings({
          enabled: settings.enabled,
          volume,
          selectedSoundId: settings.selectedSoundId,
        });
      },
      selectSound: async (soundId) => {
        assertKnownSound(settings, soundId);
        await saveSettings({
          enabled: settings.enabled,
          volume: settings.volume,
          selectedSoundId: soundId,
        });
      },
      importCustomSound: async (file) => {
        const importedSound = await importNotificationSoundFromFile(file);
        const nextSettings = withBundledSounds({
          ...settings,
          customSounds: [...settings.customSounds, importedSound],
          selectedSoundId: importedSound.id,
        });
        setSettings(nextSettings);
        setStatus("ready");
        setErrorMessage(undefined);
        toast.success(`Imported ${importedSound.label}`);
      },
      removeCustomSound: async (soundId) => {
        const nextSettings = withBundledSounds(await removeNotificationSound(soundId));
        setSettings(nextSettings);
        setStatus("ready");
        setErrorMessage(undefined);
      },
      previewSound: async (sound) => {
        await playNotificationSound(sound, settings.volume, audioRef, setPlayingSoundId);
      },
    }),
    [errorMessage, playingSoundId, saveSettings, selectedSound, settings, status],
  );

  return (
    <NotificationSettingsContext.Provider value={value}>
      {children}
    </NotificationSettingsContext.Provider>
  );
}

function useNotificationSettings() {
  const context = useContext(NotificationSettingsContext);
  if (context === missingNotificationSettingsContext) {
    throw new Error("useNotificationSettings must be used inside NotificationSettingsProvider");
  }

  return context;
}

function withBundledSounds(settings: NotificationSettings): NotificationSettings {
  return { ...settings, bundledSounds: bundledNotificationSounds };
}

function selectedSoundFromSettings(settings: NotificationSettings): NotificationSound {
  const allSounds = [...settings.bundledSounds, ...settings.customSounds];
  const selectedSound = allSounds.find((sound) => sound.id === settings.selectedSoundId);
  if (selectedSound === undefined) {
    throw new Error(`Selected notification sound is missing: ${settings.selectedSoundId}`);
  }

  return selectedSound;
}

function assertKnownSound(settings: NotificationSettings, soundId: string) {
  if ([...settings.bundledSounds, ...settings.customSounds].some((sound) => sound.id === soundId)) {
    return;
  }

  throw new Error(`Cannot select unknown notification sound: ${soundId}`);
}

async function importNotificationSoundFromFile(file: File) {
  if (!file.type.startsWith("audio/")) {
    throw new Error(`Custom notification sound must be an audio file: ${file.name}`);
  }

  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  return importNotificationSound({ fileName: file.name, bytes });
}

async function playNotificationSound(
  sound: NotificationSound,
  volume: number,
  audioRef: MutableRefObject<HTMLAudioElement | undefined>,
  setPlayingSoundId: (soundId: string | undefined) => void,
) {
  const source = await notificationSoundSource(sound);
  if (audioRef.current !== undefined) {
    audioRef.current.pause();
  }

  const audio = new Audio(source.url);
  audio.volume = volume;
  audioRef.current = audio;
  audio.addEventListener("ended", () => {
    cleanupPlayedSound(audio, source, audioRef, setPlayingSoundId);
  });
  audio.addEventListener("error", () => {
    cleanupPlayedSound(audio, source, audioRef, setPlayingSoundId);
  });

  setPlayingSoundId(sound.id);
  try {
    await audio.play();
  } catch (error) {
    cleanupPlayedSound(audio, source, audioRef, setPlayingSoundId);
    throw error;
  }
}

async function notificationSoundSource(sound: NotificationSound) {
  if (sound.kind === "bundled") {
    return { url: sound.url, objectUrl: undefined };
  }

  const bytes = await readNotificationSound(sound.id);
  const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }));
  return { url: objectUrl, objectUrl };
}

function cleanupPlayedSound(
  audio: HTMLAudioElement,
  source: { url: string; objectUrl: string | undefined },
  audioRef: MutableRefObject<HTMLAudioElement | undefined>,
  setPlayingSoundId: (soundId: string | undefined) => void,
) {
  if (audioRef.current !== audio) {
    return;
  }

  setPlayingSoundId(undefined);
  audioRef.current = undefined;
  if (source.objectUrl !== undefined) {
    URL.revokeObjectURL(source.objectUrl);
  }
}

function errorMessageFromUnknown(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}

export { NotificationSettingsProvider, useNotificationSettings };
