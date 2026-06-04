import { useCallback, useEffect } from "react";

import { idleExplorerTreeState, useExplorerStore } from "../store/explorerStore";

function useExplorerTree(folderPath: string | undefined) {
  const state = useExplorerStore((storeState) => {
    if (folderPath === undefined) {
      return idleExplorerTreeState;
    }

    return storeState.resources[folderPath] ?? idleExplorerTreeState;
  });
  const load = useExplorerStore((storeState) => storeState.load);
  const loadDirectoryResource = useExplorerStore((storeState) => storeState.loadDirectory);
  const refreshResource = useExplorerStore((storeState) => storeState.refresh);

  useEffect(() => {
    if (folderPath === undefined) {
      return;
    }

    void load(folderPath);
  }, [folderPath, load]);

  const loadDirectory = useCallback(
    (directoryPath: string) => {
      if (folderPath === undefined) {
        return;
      }

      void loadDirectoryResource(folderPath, directoryPath);
    },
    [folderPath, loadDirectoryResource],
  );

  const refresh = useCallback(() => {
    if (folderPath === undefined) {
      return;
    }

    void refreshResource(folderPath);
  }, [folderPath, refreshResource]);

  return { state, loadDirectory, refresh };
}

export { useExplorerTree };
