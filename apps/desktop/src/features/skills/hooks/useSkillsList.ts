import { useCallback, useEffect, useState } from "react";

import type { SkillsListResult } from "../types";

import { getSkillsList } from "../api/skillsApi";

type SkillsListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: SkillsListResult }
  | { status: "error"; message: string };

function useSkillsList(projectPath: string | undefined) {
  const [state, setState] = useState<SkillsListState>({ status: "idle" });

  const load = useCallback(
    async (keepResultWhileLoading: boolean) => {
      setState((currentState) =>
        keepResultWhileLoading && currentState.status === "ready"
          ? currentState
          : { status: "loading" },
      );

      try {
        const result = await getSkillsList(projectPath === undefined ? {} : { projectPath });
        return { status: "ready", result } satisfies SkillsListState;
      } catch (error) {
        return {
          status: "error",
          message: errorMessageFromUnknown(error),
        } satisfies SkillsListState;
      }
    },
    [projectPath],
  );

  const refresh = useCallback(async () => {
    setState(await load(true));
  }, [load]);

  useEffect(() => {
    let ignoreResult = false;

    void (async () => {
      const nextState = await load(false);
      if (!ignoreResult) {
        setState(nextState);
      }
    })();

    return () => {
      ignoreResult = true;
    };
  }, [load]);

  return { state, refresh };
}

function errorMessageFromUnknown(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to load skills.";
}

export { useSkillsList };
export type { SkillsListState };
