import type * as Monaco from "monaco-editor";

import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useState } from "react";

import { currentMonacoTheme, setupShiki } from "@/features/editor/components/monacoShiki";

type MonacoDiffViewerProps = {
  originalContent: string;
  modifiedContent: string;
  language: string;
  modelKey: string;
  renderSideBySide: boolean;
};

function MonacoDiffViewer({
  originalContent,
  modifiedContent,
  language,
  modelKey,
  renderSideBySide,
}: MonacoDiffViewerProps) {
  const [diffEditor, setDiffEditor] = useState<Monaco.editor.IStandaloneDiffEditor>();
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

  useEffect(() => {
    if (diffEditor === undefined) {
      return;
    }

    diffEditor.updateOptions({ renderSideBySide });
  }, [diffEditor, renderSideBySide]);

  const handleMount: DiffOnMount = useCallback((mountedDiffEditor, monaco) => {
    setDiffEditor(mountedDiffEditor);
    setMonacoInstance(monaco);

    async function configureHighlighting() {
      await setupShiki(monaco);
      monaco.editor.setTheme(currentMonacoTheme());
    }

    void configureHighlighting();
    mountedDiffEditor.focus();
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
        renderSideBySide,
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
