import type { IDockviewPanelProps } from "dockview-react";

import { useEffect, useState } from "react";

import type { EditorFileReadResult } from "../types";

import { readEditorFile } from "../api/editorApi";
import { languageForPath } from "../language";
import { MonacoFileEditor } from "./MonacoFileEditor";

type FileEditorPanelParams = {
  folderPath: string;
  filePath: string;
};

type FileLoadState =
  | { status: "loading" }
  | { status: "ready"; result: EditorFileReadResult }
  | { status: "error"; message: string };

function FileEditorPanel({ params, api }: IDockviewPanelProps<FileEditorPanelParams>) {
  const [state, setState] = useState<FileLoadState>({ status: "loading" });

  useEffect(() => {
    let ignoreResult = false;
    setState({ status: "loading" });

    async function loadFile() {
      try {
        const result = await readEditorFile(params);
        if (!ignoreResult) {
          setState({ status: "ready", result });
        }
      } catch (error) {
        if (!ignoreResult) {
          setState({ status: "error", message: errorMessageFromUnknown(error) });
        }
      }
    }

    void loadFile();

    return () => {
      ignoreResult = true;
    };
  }, [params]);

  if (state.status === "loading") {
    return <FilePanelMessage message="Loading file…" />;
  }

  if (state.status === "error") {
    return <FilePanelMessage role="alert" message={state.message} />;
  }

  if (state.result.kind === "binary") {
    return <FilePanelMessage message="Binary file. Text preview is unavailable." />;
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-editor-surface">
      <div className="flex h-9 shrink-0 items-center border-b border-border px-3 font-mono text-xs text-muted-foreground">
        <span className="truncate">{state.result.path}</span>
      </div>
      <div className="min-h-0 flex-1">
        <MonacoFileEditor
          content={state.result.content}
          language={languageForPath(params.filePath)}
          modelPath={`file-editor:${api.id}:${params.filePath}`}
        />
      </div>
    </section>
  );
}

function FilePanelMessage({ message, role }: { message: string; role?: "alert" }) {
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

  return "Failed to load file.";
}

export { FileEditorPanel, type FileEditorPanelParams };
