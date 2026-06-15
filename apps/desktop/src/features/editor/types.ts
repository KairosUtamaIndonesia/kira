type EditorFileInput = {
  folderPath: string;
  filePath: string;
};

type EditorFileWriteInput = {
  folderPath: string;
  filePath: string;
  content: string;
};

type EditorFileReadResult =
  | {
      kind: "text";
      path: string;
      content: string;
    }
  | {
      kind: "binary";
      path: string;
    };

export type { EditorFileInput, EditorFileReadResult, EditorFileWriteInput };
