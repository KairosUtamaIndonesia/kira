import type * as Monaco from "monaco-editor";

import { Editor, type OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useState } from "react";

import { currentMonacoTheme, setupShiki } from "./monacoShiki";

type MonacoFileEditorFocusRequest = {
  sequence: number;
  lineNumber: number;
  column: number;
};

type MonacoFileEditorProps = {
  content: string;
  focusRequest?: MonacoFileEditorFocusRequest | undefined;
  language: string;
  modelPath: string;
};

function MonacoFileEditor({ content, focusRequest, language, modelPath }: MonacoFileEditorProps) {
  const [editorInstance, setEditorInstance] = useState<Monaco.editor.IStandaloneCodeEditor>();
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
    if (editorInstance === undefined || focusRequest === undefined) {
      return;
    }

    focusEditorAtRequest(editorInstance, focusRequest);
  }, [editorInstance, focusRequest]);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    setEditorInstance(editor);
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

function focusEditorAtRequest(
  editor: Monaco.editor.IStandaloneCodeEditor,
  focusRequest: MonacoFileEditorFocusRequest,
) {
  const position = {
    lineNumber: focusRequest.lineNumber,
    column: focusRequest.column,
  };

  editor.setPosition(position);
  editor.revealPositionInCenter(position, 0);
  editor.focus();
}

export { MonacoFileEditor };
