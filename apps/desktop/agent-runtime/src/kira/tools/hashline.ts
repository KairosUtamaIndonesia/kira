/**
 * Content-anchored editing — the whole of Kira's "hash editing".
 *
 * A file's tag is a hash of its current content, nothing more. `read_file`
 * stamps it into a `[path#TAG]` header; `edit_file` recomputes it from disk and
 * refuses to apply when it no longer matches. There is no snapshot store and no
 * three-way merge: a stale tag means the file moved under the model, so we fail
 * fast and tell it to re-read. This module is pure (no filesystem access) so the
 * parser and applier are unit-testable on their own.
 */
import { createHash } from "node:crypto";

const DEFAULT_READ_LINES = 2000;

/**
 * Fingerprint a file's content. Line-ending agnostic: the LF and CRLF forms of
 * the same text share a tag, so an edit validates whichever the file uses.
 */
export function fileTag(content: string): string {
  const lf = content.replaceAll("\r\n", "\n");
  return createHash("sha256").update(lf).digest("hex").slice(0, 8).toUpperCase();
}

interface FileShape {
  lines: string[];
  newline: string;
  finalNewline: boolean;
}

/** Split content into editable lines, remembering how to reassemble it. */
function splitLines(content: string): FileShape {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lf = content.replaceAll("\r\n", "\n");
  const finalNewline = lf.endsWith("\n");
  const core = finalNewline ? lf.slice(0, -1) : lf;
  const lines = core.length === 0 && !finalNewline ? [] : core.split("\n");
  return { lines, newline, finalNewline };
}

/** Reassemble edited lines into file content, restoring newline + trailing EOL. */
function joinLines(shape: FileShape, lines: string[]): string {
  const body = lines.join("\n") + (shape.finalNewline ? "\n" : "");
  return shape.newline === "\n" ? body : body.replaceAll("\n", "\r\n");
}

interface ReadView {
  text: string;
  tag: string;
  total: number;
}

/** Render a file as a `[path#TAG]` header plus a 1-indexed line window. */
export function renderRead(
  path: string,
  content: string,
  offset?: number,
  limit?: number,
): ReadView {
  const tag = fileTag(content);
  const { lines } = splitLines(content);
  const header = `[${path}#${tag}]`;
  if (lines.length === 0) {
    return { text: header, tag, total: 0 };
  }

  const start = offset !== undefined && offset > 0 ? offset : 1;
  const max = limit !== undefined && limit > 0 ? limit : DEFAULT_READ_LINES;
  const window = lines.slice(start - 1, start - 1 + max);
  const numbered = window.map((line, index) => `${start + index}:${line}`).join("\n");

  const shown = start - 1 + window.length;
  const footer =
    shown < lines.length
      ? `\n[showing lines ${start}-${shown} of ${lines.length}; page with offset/limit]`
      : "";
  return { text: `${header}\n${numbered}${footer}`, tag, total: lines.length };
}

type Op =
  | { kind: "replace"; start: number; end: number; body: string[] }
  | { kind: "delete"; start: number; end: number }
  | { kind: "insert"; at: number | "end"; body: string[] };

interface Patch {
  path: string;
  tag: string;
  ops: Op[];
}

const HEADER_RE = /^\[(.+)#([0-9A-F]{8})\]$/;
const REPLACE_RE = /^replace (\d+)(?:\.\.(\d+))?:$/;
const DELETE_RE = /^delete (\d+)(?:\.\.(\d+))?$/;
const INSERT_BEFORE_RE = /^insert before (\d+):$/;
const INSERT_AFTER_RE = /^insert after (\d+):$/;

/** Read consecutive `+`-prefixed body rows, stripping one leading `+` from each. */
function readBody(lines: string[], from: number): { body: string[]; next: number } {
  const body: string[] = [];
  let cursor = from;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line === undefined || !line.startsWith("+")) {
      break;
    }
    body.push(line.slice(1));
    cursor += 1;
  }
  return { body, next: cursor };
}

/** Parse a hashline patch: a `[path#TAG]` header followed by line-anchored ops. */
export function parsePatch(input: string): Patch {
  const lines = input.replaceAll("\r\n", "\n").split("\n");
  let cursor = 0;
  while (cursor < lines.length && (lines[cursor] ?? "").trim() === "") {
    cursor += 1;
  }

  const header = (lines[cursor] ?? "").match(HEADER_RE);
  const path = header === null ? undefined : header[1];
  const tag = header === null ? undefined : header[2];
  if (path === undefined || tag === undefined) {
    throw new Error(
      `First line must be a "[path#TAG]" header copied from read/write, e.g. "[src/foo.ts#1A2B3C4D]".`,
    );
  }
  cursor += 1;

  const ops: Op[] = [];
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line === undefined || line.trim() === "") {
      cursor += 1;
      continue;
    }

    const replace = line.match(REPLACE_RE);
    if (replace !== null && replace[1] !== undefined) {
      const start = Number(replace[1]);
      const end = replace[2] === undefined ? start : Number(replace[2]);
      const { body, next } = readBody(lines, cursor + 1);
      ops.push({ kind: "replace", start, end, body });
      cursor = next;
      continue;
    }

    const remove = line.match(DELETE_RE);
    if (remove !== null && remove[1] !== undefined) {
      const start = Number(remove[1]);
      const end = remove[2] === undefined ? start : Number(remove[2]);
      ops.push({ kind: "delete", start, end });
      cursor += 1;
      continue;
    }

    const before = line.match(INSERT_BEFORE_RE);
    if (before !== null && before[1] !== undefined) {
      const { body, next } = readBody(lines, cursor + 1);
      ops.push({ kind: "insert", at: Number(before[1]) - 1, body });
      cursor = next;
      continue;
    }

    const after = line.match(INSERT_AFTER_RE);
    if (after !== null && after[1] !== undefined) {
      const { body, next } = readBody(lines, cursor + 1);
      ops.push({ kind: "insert", at: Number(after[1]), body });
      cursor = next;
      continue;
    }

    if (line === "insert head:") {
      const { body, next } = readBody(lines, cursor + 1);
      ops.push({ kind: "insert", at: 0, body });
      cursor = next;
      continue;
    }

    if (line === "insert tail:") {
      const { body, next } = readBody(lines, cursor + 1);
      ops.push({ kind: "insert", at: "end", body });
      cursor = next;
      continue;
    }

    throw new Error(
      `Unrecognized edit op: "${line}". See the edit tool description for the format.`,
    );
  }

  if (ops.length === 0) {
    throw new Error("Patch contained a header but no edit ops.");
  }
  return { path, tag, ops };
}

interface Splice {
  start: number;
  deleteCount: number;
  insert: string[];
}

function resolveOp(op: Op, length: number): Splice {
  if (op.kind === "insert") {
    const at = op.at === "end" ? length : op.at;
    if (at < 0 || at > length) {
      throw new Error(`Insert position ${at} is out of range (file has ${length} lines).`);
    }
    return { start: at, deleteCount: 0, insert: op.body };
  }

  if (op.start < 1 || op.end < op.start || op.end > length) {
    throw new Error(
      `${op.kind} ${op.start}..${op.end} is out of range (file has ${length} lines).`,
    );
  }
  return {
    start: op.start - 1,
    deleteCount: op.end - op.start + 1,
    insert: op.kind === "replace" ? op.body : [],
  };
}

/**
 * Apply ops expressed in original-file coordinates. Ops are validated for
 * overlap, then spliced from the bottom up so earlier line numbers stay valid.
 */
export function applyOps(originalLines: string[], ops: Op[]): string[] {
  const splices = ops
    .map((op, index) => ({ splice: resolveOp(op, originalLines.length), index }))
    .toSorted((a, b) => a.splice.start - b.splice.start || a.index - b.index);

  let reach = 0;
  for (const { splice } of splices) {
    if (splice.start < reach) {
      throw new Error("Edit ops overlap. Combine them into one range or split the patch.");
    }
    reach = splice.start + splice.deleteCount;
  }

  const out = originalLines.slice();
  for (let i = splices.length - 1; i >= 0; i -= 1) {
    const splice = splices[i];
    if (splice !== undefined) {
      out.splice(splice.splice.start, splice.splice.deleteCount, ...splice.splice.insert);
    }
  }
  return out;
}

interface EditResult {
  content: string;
  tag: string;
  changed: number;
}

/**
 * Apply a parsed patch to `content`, verifying the patch's tag still matches.
 * Throws on a stale tag so the model re-reads instead of clobbering new content.
 */
export function applyPatch(content: string, patch: Patch): EditResult {
  const currentTag = fileTag(content);
  if (currentTag !== patch.tag) {
    throw new Error(
      `Stale tag: ${patch.path} is now #${currentTag}, not #${patch.tag}. ` +
        `It changed since you read it — re-read to get the current content and tag.`,
    );
  }

  const shape = splitLines(content);
  const edited = applyOps(shape.lines, patch.ops);
  const next = joinLines(shape, edited);
  return { content: next, tag: fileTag(next), changed: patch.ops.length };
}
