import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEditFileTool, createReadFileTool } from "./file-tools";
import { applyPatch, fileTag, parsePatch, renderRead } from "./hashline";

function project() {
  return mkdtempSync(join(tmpdir(), "kira-hash-"));
}

describe("hashline engine", () => {
  test("renderRead emits a content tag and 1-indexed lines", () => {
    const view = renderRead("foo.ts", "const a = 1;\nconst b = 2;\n");
    expect(view.text).toBe(
      `[foo.ts#${fileTag("const a = 1;\nconst b = 2;\n")}]\n1:const a = 1;\n2:const b = 2;`,
    );
    expect(view.total).toBe(2);
  });

  test("a patch replaces, inserts, and deletes against original line numbers", () => {
    const original = "a\nb\nc\nd\n";
    const patch = parsePatch(
      `[x.ts#${fileTag(original)}]\nreplace 2..2:\n+B\ndelete 3\ninsert after 4:\n+e`,
    );
    expect(applyPatch(original, patch).content).toBe("a\nB\nd\ne\n");
  });

  test("insert head and tail target the file boundaries", () => {
    const original = "mid\n";
    const patch = parsePatch(
      `[x.ts#${fileTag(original)}]\ninsert head:\n+top\ninsert tail:\n+bottom`,
    );
    expect(applyPatch(original, patch).content).toBe("top\nmid\nbottom\n");
  });

  test("a stale tag is rejected, never applied", () => {
    const patch = parsePatch("[x.ts#00000000]\nreplace 1..1:\n+z");
    expect(() => applyPatch("real\n", patch)).toThrow(/Stale tag/);
  });

  test("CRLF files keep their line endings and stay tag-stable", () => {
    const original = "a\r\nb\r\n";
    expect(fileTag(original)).toBe(fileTag("a\nb\n"));
    const patch = parsePatch(`[x.ts#${fileTag(original)}]\nreplace 2..2:\n+B`);
    expect(applyPatch(original, patch).content).toBe("a\r\nB\r\n");
  });

  test("overlapping ops are rejected", () => {
    const original = "a\nb\nc\n";
    const patch = parsePatch(`[x.ts#${fileTag(original)}]\nreplace 1..2:\n+X\ndelete 2`);
    expect(() => applyPatch(original, patch)).toThrow(/overlap/);
  });
});

describe("read_file / edit_file tools", () => {
  test("read_file mints a tag that edit_file applies and chains", async () => {
    const dir = project();
    const read = createReadFileTool(dir);
    const edit = createEditFileTool(dir);
    writeFileSync(join(dir, "foo.ts"), "const a = 1;\nconst b = 2;\nconst c = 3;\n");

    const readOut = await read.execute({ path: "foo.ts" });
    const tag = fileTag("const a = 1;\nconst b = 2;\nconst c = 3;\n");
    expect(readOut).toContain(`[foo.ts#${tag}]`);

    const editOut = await edit.execute({ input: `[foo.ts#${tag}]\nreplace 2..2:\n+const b = 20;` });
    expect(readFileSync(join(dir, "foo.ts"), "utf8")).toBe(
      "const a = 1;\nconst b = 20;\nconst c = 3;\n",
    );

    const nextTag = fileTag(readFileSync(join(dir, "foo.ts"), "utf8"));
    expect(editOut).toContain(`[foo.ts#${nextTag}]`);
    await edit.execute({ input: `[foo.ts#${nextTag}]\nreplace 1..1:\n+const a = 100;` });
    expect(readFileSync(join(dir, "foo.ts"), "utf8")).toBe(
      "const a = 100;\nconst b = 20;\nconst c = 3;\n",
    );
  });

  test("read_file pages with offset and limit", async () => {
    const dir = project();
    const read = createReadFileTool(dir);
    writeFileSync(join(dir, "many.ts"), "1\n2\n3\n4\n5\n");

    const out = await read.execute({ path: "many.ts", offset: 2, limit: 2 });
    expect(out).toContain("2:2");
    expect(out).toContain("3:3");
    expect(out).not.toContain("4:4");
  });

  test("a stale tag leaves the file untouched", async () => {
    const dir = project();
    const edit = createEditFileTool(dir);
    writeFileSync(join(dir, "bar.ts"), "x\ny\n");

    await expect(edit.execute({ input: "[bar.ts#00000000]\nreplace 1..1:\n+z" })).rejects.toThrow(
      /Stale tag/,
    );
    expect(readFileSync(join(dir, "bar.ts"), "utf8")).toBe("x\ny\n");
  });
});
