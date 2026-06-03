import type * as Monaco from "monaco-editor";

import { Editor, type OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useState } from "react";

import { currentMonacoTheme, setupShiki } from "./monacoShiki";

type MonacoFileEditorProps = {
  content: string;
  language: string;
  modelPath: string;
};

function MonacoFileEditor({ content, language, modelPath }: MonacoFileEditorProps) {
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

  const handleMount: OnMount = useCallback((editor, monaco) => {
    setMonacoInstance(monaco);

    async function configureHighlighting() {
      await setupShiki(monaco);
      monaco.editor.setTheme(currentMonacoTheme());
    }

    void configureHighlighting();
    editor.focus();
  }, []);

  return (
    <Editor
      height="100%"
      value={content}
      language={language}
      theme={theme}
      path={modelPath}
      keepCurrentModel
      onMount={handleMount}
      options={{
        readOnly: true,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        lineNumbers: "on",
        fontFamily: "var(--font-mono)",
        fontSize: 13,
      }}
    />
  );
}

export { MonacoFileEditor };
