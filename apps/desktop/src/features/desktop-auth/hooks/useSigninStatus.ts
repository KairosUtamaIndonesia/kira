import { useEffect, useState } from "react";

import type { SigninStatus } from "../types";

import { getSigninStatus } from "../api/desktopAuthApi";

/// Returns the current desktop sign-in status, loaded once on mount. The General
/// settings section uses this to render the signed-in user's identity and
/// decide whether the Log out button is meaningful.
function useSigninStatus(): SigninStatus | undefined {
  const [status, setStatus] = useState<SigninStatus | undefined>();

  useEffect(() => {
    let active = true;

    async function loadStatus() {
      const resolved = await getSigninStatus();

      if (active) {
        setStatus(resolved);
      }
    }

    void loadStatus();

    return () => {
      active = false;
    };
  }, []);

  return status;
}

export { useSigninStatus };
