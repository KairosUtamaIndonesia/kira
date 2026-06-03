import { shikiToMonaco } from "@shikijs/monaco";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useCallback } from "react";
import { createHighlighter, type Highlighter } from "shiki";

import { shikiLanguages } from "../language";

let shikiSetupPromise: Promise<void> | undefined;

function setupShiki(monaco: typeof Monaco) {
  shikiSetupPromise ??= setupShikiOnce(monaco);
  return shikiSetupPromise;
}

async function setupShikiOnce(monaco: typeof Monaco) {
  const highlighter: Highlighter = await createHighlighter({
    themes: ["github-dark", "github-light"],
    langs: shikiLanguages,
  });
  for (const language of shikiLanguages) {
    if (!monaco.languages.getLanguages().some((registered) => registered.id === language)) {
      monaco.languages.register({ id: language });
    }
  }
  shikiToMonaco(highlighter, monaco);
}

type MonacoDiffViewerProps = {
  originalContent: string;
  modifiedContent: string;
  language: string;
  modelKey: string;
};

function MonacoDiffViewer({
  originalContent,
  modifiedContent,
  language,
  modelKey,
}: MonacoDiffViewerProps) {
  const handleMount: DiffOnMount = useCallback((diffEditor, monaco) => {
    async function configureHighlighting() {
      await setupShiki(monaco);
      monaco.editor.setTheme("github-dark");
    }

    void configureHighlighting();
    diffEditor.focus();
  }, []);

  return (
    <DiffEditor
      height="100%"
      original={originalContent}
      modified={modifiedContent}
      language={language}
      theme="github-dark"
      originalModelPath={`source-control-diff:original:${modelKey}`}
      modifiedModelPath={`source-control-diff:modified:${modelKey}`}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={handleMount}
      options={{
        readOnly: true,
        originalEditable: false,
        renderSideBySide: true,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        lineNumbers: "on",
        renderOverviewRuler: true,
        fontFamily: "var(--font-mono)",
        fontSize: 13,
      }}
    />
  );
}

export { MonacoDiffViewer };
