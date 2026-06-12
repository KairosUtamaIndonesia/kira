import type * as Monaco from "monaco-editor";

import { shikiToMonaco } from "@shikijs/monaco";
import { createHighlighter, type Highlighter } from "shiki";

import { shikiLanguages } from "../language";

const darkTheme = "vs-dark";
const lightTheme = "vs-light";

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
    themes: [darkTheme, lightTheme],
    langs: shikiLanguages,
  });
  for (const language of shikiLanguages) {
    if (!monaco.languages.getLanguages().some((registered) => registered.id === language)) {
      monaco.languages.register({ id: language });
    }
  }
  shikiToMonaco(highlighter, monaco);
}

export { currentMonacoTheme, setupShiki };
