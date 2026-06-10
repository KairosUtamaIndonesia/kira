import type { ElementCapturePayload } from "./types";

// Renders a captured element into a compact Markdown block suitable for both clipboard copy and
// seeding an Agent Thread prompt. Sections with no data are omitted so the block stays terse.
function formatElementCapture(payload: ElementCapturePayload): string {
  const { target, pageContext, accessibility, ancestorPath, nearbyText } = payload;
  const lines: string[] = [];

  lines.push(`## Captured element: \`<${target.tagName}>\``);
  lines.push("");
  lines.push(`- Page: ${pageContext.title || "(untitled)"} — ${pageContext.url}`);
  lines.push(`- Selector: \`${target.selector}\``);

  if (target.classes.length > 0) {
    lines.push(`- Classes: ${target.classes.map((cls) => `\`${cls}\``).join(" ")}`);
  }

  const attributeEntries = Object.entries(target.attributes);
  if (attributeEntries.length > 0) {
    lines.push("- Attributes:");
    for (const [name, value] of attributeEntries) {
      lines.push(`  - \`${name}="${value}"\``);
    }
  }

  if (accessibility.role.length > 0 || accessibility.label.length > 0) {
    const label = accessibility.label.length > 0 ? ` (label: ${accessibility.label})` : "";
    lines.push(`- Accessibility: role \`${accessibility.role}\`${label}`);
  }

  if (target.textContent.length > 0) {
    lines.push(`- Text: ${target.textContent}`);
  }

  if (pageContext.selectedText.length > 0) {
    lines.push(`- Selected text: ${pageContext.selectedText}`);
  }

  if (ancestorPath.length > 0) {
    lines.push(`- Ancestors: ${ancestorPath.join(" › ")}`);
  }

  if (nearbyText.length > 0) {
    lines.push(`- Nearby text: ${nearbyText.join(" | ")}`);
  }

  if (target.htmlSnippet.length > 0) {
    lines.push("");
    lines.push("```html");
    lines.push(target.htmlSnippet);
    lines.push("```");
  }

  return lines.join("\n");
}

export { formatElementCapture };
