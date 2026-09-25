/** Normalize a renderer or model supplied address to the browser's safe protocols. */
export function browserUrlIn(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 4_096) return null;
  const trimmed = value.trim();
  const isLocalAddress =
    /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[\da-fA-F:.]+\])(?::\d+)?(?:[/?#]|$)/i.test(trimmed);
  const candidate = trimmed.startsWith('//')
    ? `https:${trimmed}`
    : isLocalAddress && !/^https?:\/\//i.test(trimmed)
      ? `http://${trimmed}`
      : /^[a-z][a-z\d+.-]*:/i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Bound strings before they cross into a guest page operation. */
export function browserValueIn(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 10_000 ? value : null;
}
