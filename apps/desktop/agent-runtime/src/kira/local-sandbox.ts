import type { SandboxFactory, SessionEnv } from "@flue/runtime";

import { local } from "@flue/runtime/node";

function createKiraLocalSandbox(projectPath: string): SandboxFactory {
  const sandbox = local({ cwd: projectPath });

  return {
    async createSessionEnv(options) {
      const env = await sandbox.createSessionEnv(options);
      return sanitizeLocalSkillFrontmatter(env);
    },
  };
}

function sanitizeLocalSkillFrontmatter(env: SessionEnv): SessionEnv {
  return {
    ...env,
    async readFile(path) {
      const content = await env.readFile(path);
      if (!isSkillMarkdownPath(path)) {
        return content;
      }

      return sanitizeAllowedToolsFrontmatter(content);
    },
    async readFileBuffer(path) {
      const content = await env.readFileBuffer(path);
      if (!isSkillMarkdownPath(path)) {
        return content;
      }

      const decoded = new TextDecoder().decode(content);
      return new TextEncoder().encode(sanitizeAllowedToolsFrontmatter(decoded));
    },
  };
}

function isSkillMarkdownPath(path: string) {
  return path.replaceAll("\\", "/").endsWith("/SKILL.md") || path === "SKILL.md";
}

function sanitizeAllowedToolsFrontmatter(content: string) {
  const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/);
  if (frontmatter === null) {
    return content;
  }

  const body = frontmatter[2] ?? "";
  const sanitizedFrontmatter = removeAllowedToolsField(frontmatter[1] ?? "");
  return `---\n${sanitizedFrontmatter}\n---\n${body}`;
}

function removeAllowedToolsField(frontmatter: string) {
  const lines = frontmatter.split(/\r?\n/);
  const result: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      throw new Error("Frontmatter line index moved beyond the parsed skill frontmatter.");
    }

    const allowedToolsMatch = /^(\s*)allowed-tools\s*:/.exec(line);
    if (allowedToolsMatch === null) {
      result.push(line);
      continue;
    }

    const fieldIndentMatch = allowedToolsMatch[1];
    if (fieldIndentMatch === undefined) {
      throw new Error("allowed-tools frontmatter indentation was not captured.");
    }
    const fieldIndent = fieldIndentMatch.length;

    index = skipIndentedYamlBlock(lines, index, fieldIndent);
  }

  return result.join("\n").trimEnd();
}

function skipIndentedYamlBlock(lines: string[], startIndex: number, fieldIndent: number) {
  let index = startIndex;

  for (let nextIndex = startIndex + 1; nextIndex < lines.length; nextIndex += 1) {
    const nextLine = lines[nextIndex];
    if (nextLine === undefined) {
      throw new Error("Frontmatter continuation index moved beyond the parsed skill frontmatter.");
    }

    if (nextLine.trim().length === 0) {
      index = nextIndex;
      continue;
    }

    if (indentLength(nextLine) <= fieldIndent) {
      break;
    }

    index = nextIndex;
  }

  return index;
}

function indentLength(line: string) {
  const match = /^(\s*)/.exec(line);
  if (match === null || match[1] === undefined) {
    throw new Error("YAML frontmatter indentation could not be measured.");
  }

  return match[1].length;
}

export { createKiraLocalSandbox };
