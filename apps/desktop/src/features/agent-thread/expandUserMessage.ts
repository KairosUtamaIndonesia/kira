import type { InstalledSkill } from "@/features/skills";

import { expandSkill } from "@/features/skills/api/skillsApi";

/**
 * Replace every `/skill:<name> <args>` invocation in `text` with a
 * Pi-compatible `<skill>` block plus trailing args, mirroring
 * `_expandSkillCommand` in pi-coding-agent. The transport performs the same
 * expansion as a safety net; when the client has already expanded, no
 * `/skill:` tokens remain and the transport becomes a no-op.
 *
 * The expansion target uses the same wire format that
 * `parseUserMessageBlocks` understands, so the local transcript entry renders
 * the collapsible skill chip on the client.
 */
async function expandSlashCommandInText(
  text: string,
  context: { projectPath?: string; skills: readonly InstalledSkill[] },
): Promise<string> {
  const pattern = /(^|\s)(\/skill:([A-Za-z0-9_:-]+))((?:\s[^\n]*)?)/g;
  const matches: Array<{
    lead: string;
    full: string;
    name: string;
    args: string;
    start: number;
    end: number;
  }> = [];
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined || match[1] === undefined || match[2] === undefined) {
      continue;
    }
    matches.push({
      lead: match[1],
      full: match[2],
      name: match[3] ?? "",
      args: match[4] ?? "",
      start: match.index + match[1].length,
      end: match.index + match[1].length + match[2].length,
    });
  }
  if (matches.length === 0) {
    return text;
  }
  const knownNames = new Set(
    context.skills.filter((skill) => !skill.conflict).map((skill) => skill.name),
  );
  const expandMatches = matches.filter((match) => knownNames.has(match.name));
  const bodies = await Promise.all(
    expandMatches.map((match) => fetchSkillBody(match.name, context)),
  );
  let result = "";
  let cursor = 0;
  let expandIndex = 0;
  for (const match of matches) {
    if (!knownNames.has(match.name)) {
      continue;
    }
    const body = bodies[expandIndex] ?? "";
    expandIndex += 1;
    result += text.slice(cursor, match.start);
    result += buildSkillBlock(match.name, body, match.args.trim());
    cursor = match.end;
  }
  result += text.slice(cursor);
  return result;
}

async function fetchSkillBody(name: string, context: { projectPath?: string }): Promise<string> {
  try {
    const result = await expandSkill({
      name,
      ...(context.projectPath === undefined ? {} : { projectPath: context.projectPath }),
    });
    return result.body;
  } catch {
    return "";
  }
}

function buildSkillBlock(name: string, body: string, args: string): string {
  const trimmedBody = body.trim();
  const block =
    trimmedBody.length === 0
      ? `<skill name="${name}" />`
      : `<skill name="${name}">\n${trimmedBody}\n</skill>`;
  return args.length === 0 ? block : `${block}\n\n${args}`;
}

export { buildSkillBlock, expandSlashCommandInText };
