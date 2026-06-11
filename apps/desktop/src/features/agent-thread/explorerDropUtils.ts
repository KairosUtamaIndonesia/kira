import { explorerDragDataKey } from "@/features/explorer";

function fileReferenceText(path: string) {
  return path.includes(" ") ? `@"${path}" ` : `@${path} `;
}

function explorerDropPaths(dataTransfer: DataTransfer): readonly string[] {
  const data = dataTransfer.getData(explorerDragDataKey);
  if (data.length === 0) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const paths: string[] = [];
  for (const item of parsed as unknown[]) {
    if (typeof item !== "string") {
      return [];
    }
    paths.push(item);
  }

  return paths;
}

export { explorerDropPaths, fileReferenceText };
