import type { IDockviewPanelProps } from "dockview-react";

import { Columns2, Rows2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { languageForPath } from "@/features/editor/language";

import type { SourceControlDiffResult, SourceControlDiffSource } from "../types";

import { getSourceControlDiff } from "../api/sourceControlApi";
import { MonacoDiffViewer } from "./MonacoDiffViewer";

type SourceControlDiffPanelParams = {
  folderPath: string;
  filePath: string;
  oldPath: string | null;
  source: SourceControlDiffSource;
};

type DiffLoadState =
  | { status: "loading" }
  | { status: "ready"; result: SourceControlDiffResult }
  | { status: "error"; message: string };

function SourceControlDiffPanel({
  params,
  api,
}: IDockviewPanelProps<SourceControlDiffPanelParams>) {
  const [state, setState] = useState<DiffLoadState>({ status: "loading" });
  const [renderSideBySide, setRenderSideBySide] = useState(true);

  useEffect(() => {
    let ignoreResult = false;
    setState({ status: "loading" });

    async function loadDiff() {
      try {
        const result = await getSourceControlDiff(params);
        if (!ignoreResult) {
          setState({ status: "ready", result });
        }
      } catch (error) {
        if (!ignoreResult) {
          setState({ status: "error", message: errorMessageFromUnknown(error) });
        }
      }
    }

    void loadDiff();

    return () => {
      ignoreResult = true;
    };
  }, [params]);

  if (state.status === "loading") {
    return <DiffPanelMessage message="Loading diff…" />;
  }

  if (state.status === "error") {
    return <DiffPanelMessage role="alert" message={state.message} />;
  }

  if (state.result.kind === "binary") {
    return <DiffPanelMessage message="Binary file changed. Text diff is unavailable." />;
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-editor-surface">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
        <span className="truncate">{state.result.originalPath}</span>
        <span aria-hidden="true">→</span>
        <span className="truncate text-foreground">{state.result.modifiedPath}</span>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Show inline diff"
                  aria-pressed={!renderSideBySide}
                  className="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                  onClick={() => setRenderSideBySide(false)}
                >
                  <Rows2 aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>Inline diff</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Show side-by-side diff"
                  aria-pressed={renderSideBySide}
                  className="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                  onClick={() => setRenderSideBySide(true)}
                >
                  <Columns2 aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>Side-by-side diff</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <MonacoDiffViewer
          originalContent={state.result.originalContent}
          modifiedContent={state.result.modifiedContent}
          language={languageForPath(params.filePath)}
          modelKey={api.id}
          renderSideBySide={renderSideBySide}
        />
      </div>
    </section>
  );
}

function DiffPanelMessage({ message, role }: { message: string; role?: "alert" }) {
  return (
    <div
      role={role}
      className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground"
    >
      {message}
    </div>
  );
}

function errorMessageFromUnknown(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to load source control diff.";
}

export { SourceControlDiffPanel, type SourceControlDiffPanelParams };
