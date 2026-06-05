import type * as Monaco from "monaco-editor";

import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useState } from "react";

import { languageForPath } from "@/features/editor/language";
import { currentMonacoTheme, setupShiki } from "@/features/editor/components/monacoShiki";

type AgentThreadToolDiffProps = {
  filePath: string | undefined;
  modifiedContent: string;
  modelKey: string;
  originalContent: string;
};

function AgentThreadToolDiff({
  filePath,
  modifiedContent,
  modelKey,
  originalContent,
}: AgentThreadToolDiffProps) {
  const [monacoInstance, setMonacoInstance] = useState<typeof Monaco>();
  const [theme, setTheme] = useState(currentMonacoTheme());
  const language = filePath === undefined ? "plaintext" : languageForPath(filePath);

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
    <div className="h-80 overflow-hidden rounded-md border border-border bg-editor-surface">
      <DiffEditor
        height="100%"
        original={originalContent}
        modified={modifiedContent}
        language={language}
        theme={theme}
        originalModelPath={`agent-thread-tool-diff:original:${modelKey}`}
        modifiedModelPath={`agent-thread-tool-diff:modified:${modelKey}`}
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
          renderOverviewRuler: false,
          fontFamily: "var(--font-mono)",
          fontSize: 12,
        }}
      />
    </div>
  );
}

export { AgentThreadToolDiff };
