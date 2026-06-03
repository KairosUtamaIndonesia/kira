const extensionLanguages: Record<string, string> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  md: "markdown",
  py: "python",
  rs: "rust",
  sh: "shellscript",
  sql: "sql",
  ts: "typescript",
  tsx: "typescript",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
};

const shikiLanguages = Array.from(new Set(Object.values(extensionLanguages)));

function languageForPath(path: string) {
  const extension = path.split(".").pop();
  if (extension === undefined) {
    return "plaintext";
  }

  return extensionLanguages[extension.toLowerCase()] ?? "plaintext";
}

export { languageForPath, shikiLanguages };
