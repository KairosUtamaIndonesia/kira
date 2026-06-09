import { defineTool, Type, type ToolDefinition } from "@flue/runtime";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { applyPatch, parsePatch, renderRead } from "./hashline";

/**
 * Content-anchored file tools layered on top of Flue's default toolset.
 *
 * Flue's built-in `read`/`edit` stay available, but these add the hashline
 * pair: `read_file` returns a `[path#TAG]` header the model copies into
 * `edit_file`, which refuses to apply when the file's content no longer hashes
 * to that tag. Custom tools receive no `SessionEnv`, so they resolve against the
 * agent thread's `projectPath` directly — Kira desktop always runs the local
 * sandbox rooted there.
 */

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value;
}

function optionalPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined;
}

const readFileParameters = Type.Object({
  path: Type.String({ description: "Path to the file to read, relative to the project root." }),
  offset: Type.Optional(Type.Number({ description: "1-indexed line to start from. Default 1." })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to show." })),
});

const READ_FILE_DESCRIPTION =
  "Read a file for editing. Returns a `[path#TAG]` header followed by 1-indexed `N:content` lines. Copy that exact header and the bare line numbers into `edit_file`. Use this instead of the built-in `read` tool whenever you intend to edit the file. Large files are truncated — use offset/limit to page.";

function createReadFileTool(projectPath: string): ToolDefinition {
  return defineTool({
    name: "read_file",
    description: READ_FILE_DESCRIPTION,
    parameters: readFileParameters,
    async execute(args) {
      const path = requireNonEmptyString(args.path, "path");
      const content = await readFile(resolve(projectPath, path), "utf8");
      return renderRead(
        path,
        content,
        optionalPositiveInt(args.offset),
        optionalPositiveInt(args.limit),
      ).text;
    },
  });
}

const editFileParameters = Type.Object({
  input: Type.String({
    description: "A hashline patch: a [path#TAG] header followed by edit ops.",
  }),
});

const EDIT_FILE_DESCRIPTION = `Apply a content-anchored patch to a file. Use this instead of the built-in \`edit\` tool. The first line is the [path#TAG] header from the latest read_file of that file; the TAG must match the file's current content, or the edit is rejected and you must read_file again.

Ops (line numbers are 1-indexed against the file you read; ranges are inclusive and do not shift as ops apply):
  replace A:        replace line A with the body rows
  replace A..B:     replace lines A..B with the body rows
  delete A          delete line A (no body)
  delete A..B       delete lines A..B (no body)
  insert before A:  insert the body rows before line A
  insert after A:   insert the body rows after line A
  insert head:      insert the body rows at the start of the file
  insert tail:      insert the body rows at the end of the file

Body rows start with "+"; a lone "+" is a blank line. Example:
  [src/foo.ts#1A2B3C4D]
  replace 2..2:
  +const answer = 42;
  insert after 5:
  +log(answer);`;

function createEditFileTool(projectPath: string): ToolDefinition {
  return defineTool({
    name: "edit_file",
    description: EDIT_FILE_DESCRIPTION,
    parameters: editFileParameters,
    async execute(args) {
      const patch = parsePatch(requireNonEmptyString(args.input, "input"));
      const absolute = resolve(projectPath, patch.path);
      const result = applyPatch(await readFile(absolute, "utf8"), patch);
      await writeFile(absolute, result.content);
      return `[${patch.path}#${result.tag}]\napplied ${result.changed} edit op(s)`;
    },
  });
}

export { createReadFileTool, createEditFileTool };
