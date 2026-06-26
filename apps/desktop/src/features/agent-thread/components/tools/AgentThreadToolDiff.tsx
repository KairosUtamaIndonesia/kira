import type * as Monaco from "monaco-editor";

import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { Columns2, Rows2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { currentMonacoTheme, setupShiki } from "@/features/editor/components/monacoShiki";
import { languageForPath } from "@/features/source-control/language";

type Props = {
  filePath: string | undefined;
  modelKey: string;
  originalContent: string;
  modifiedContent: string;
};

function AgentThreadToolDiff({ filePath, modelKey, originalContent, modifiedContent }: Props) {
  const [diffEditor, setDiffEditor] = useState<Monaco.editor.IStandaloneDiffEditor>();
  const [monacoInstance, setMonacoInstance] = useState<typeof Monaco>();
  const [renderSideBySide, setRenderSideBySide] = useState(true);
  const [theme, setTheme] = useState(currentMonacoTheme());

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentMonacoTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (monacoInstance === undefined) return;
    monacoInstance.editor.setTheme(theme);
  }, [monacoInstance, theme]);

  useEffect(() => {
    if (diffEditor === undefined) return;
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
  }, []);

  const language = languageForPath(filePath ?? "unknown");

  return (
    <div>
      <div className="flex items-center justify-end px-2 py-1">
        <div className="flex items-center gap-1">
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
      <div className="h-60">
        <DiffEditor
          height="100%"
          original={originalContent}
          modified={modifiedContent}
          language={language}
          theme={theme}
          originalModelPath={`agent-thread-diff:original:${modelKey}`}
          modifiedModelPath={`agent-thread-diff:modified:${modelKey}`}
          keepCurrentOriginalModel
          keepCurrentModifiedModel
          onMount={handleMount}
          options={{
            readOnly: true,
            originalEditable: false,
            renderSideBySide,
            renderSideBySideInlineBreakpoint: 0,
            useInlineViewWhenSpaceIsLimited: false,
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            lineNumbers: "on",
            renderOverviewRuler: false,
            fontFamily: "var(--font-mono)",
            fontSize: 13,
          }}
        />
      </div>
    </div>
  );
}

export { AgentThreadToolDiff };
