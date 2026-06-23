import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Checks GitHub Releases for a newer signed build on mount and, when one is
 * available, offers a non-blocking toast to install and restart.
 *
 * The update server is an external dependency: when it is unreachable or has no
 * published release yet, the check fails silently instead of nagging on every
 * launch. Install failures are surfaced because the user explicitly opted in.
 */
function UpdateChecker() {
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      let update: Update | undefined;
      try {
        const result = await check();
        if (result) {
          update = result;
        }
      } catch (error) {
        toast.error("Update check failed", {
          description: errorMessageFromUnknown(error),
          duration: 15000,
        });
        return;
      }

      if (cancelled || !update) {
        return;
      }

      toast(`Update available: ${update.version}`, {
        description: update.body ?? "A new version of Kira is ready to install.",
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Install & restart",
          onClick: () => {
            void installUpdate(update);
          },
        },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return <></>;
}

async function installUpdate(update: Update) {
  const toastId = toast.loading(`Installing ${update.version}…`);

  try {
    await update.downloadAndInstall();
    await relaunch();
  } catch (error) {
    toast.error("Update failed", {
      id: toastId,
      description: errorMessageFromUnknown(error),
    });
  }
}

function errorMessageFromUnknown(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Could not install the update.";
}

export { UpdateChecker };
