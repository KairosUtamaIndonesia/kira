/**
 * Strip a leading YAML frontmatter block from a `SKILL.md` body and return
 * the remaining content. Mirrors pi-coding-agent's `stripFrontmatter` so the
 * expansion format matches what the runtime expects.
 */
function stripSkillFrontmatter(content: string): string {
  const altPrefix = "---\r\n";
  const prefix = "---\n";
  let rest: string;
  if (content.startsWith(altPrefix)) {
    rest = content.slice(altPrefix.length);
  } else if (content.startsWith(prefix)) {
    rest = content.slice(prefix.length);
  } else {
    return content;
  }
  let searchFrom = 0;
  while (searchFrom < rest.length) {
    const rel = rest.indexOf("\n---", searchFrom);
    if (rel < 0) {
      return content;
    }
    const afterClose = rest.slice(rel + 4);
    if (afterClose.length === 0 || afterClose.startsWith("\n") || afterClose.startsWith("\r\n")) {
      return afterClose;
    }
    searchFrom = rel + 4;
  }
  return content;
}

export { stripSkillFrontmatter };
