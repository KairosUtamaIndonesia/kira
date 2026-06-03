import { shikiToMonaco } from "@shikijs/monaco";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useCallback, useEffect, useState } from "react";
import { createHighlighter, type Highlighter } from "shiki";

import { shikiLanguages } from "../language";

const darkTheme = "github-dark";
const lightTheme = "github-light";

let shikiSetupPromise: Promise<void> | undefined;

function setupShiki(monaco: typeof Monaco) {
  shikiSetupPromise ??= setupShikiOnce(monaco);
  return shikiSetupPromise;
}

function currentMonacoTheme() {
  return document.documentElement.classList.contains("dark") ? darkTheme : lightTheme;
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
  const [monacoInstance, setMonacoInstance] = useState<typeof Monaco>();
  const [theme, setTheme] = useState(currentMonacoTheme());

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentMonacoTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (monacoInstance === undefined) {
      return;
    }

    monacoInstance.editor.setTheme(theme);
  }, [monacoInstance, theme]);

  const handleMount: DiffOnMount = useCallback((diffEditor, monaco) => {
    setMonacoInstance(monaco);

    async function configureHighlighting() {
      await setupShiki(monaco);
      monaco.editor.setTheme(currentMonacoTheme());
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
      theme={theme}
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
