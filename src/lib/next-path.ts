/**
 * A path on this site to return to after sign-in, or null. Anything a browser
 * could read as another origin is rejected: "//evil.com" is a
 * protocol-relative URL; "/\evil.com" becomes one because browsers turn
 * backslashes into slashes; and tabs or newlines are dropped by URL parsers,
 * so "/\t/evil.com" would become "//evil.com" too.
 */
export function safeNextPath(next: unknown): string | null {
  if (typeof next !== "string" || next.length === 0 || next.length > 500) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  if (/[\x00-\x1f\x7f]/.test(next)) return null;
  return next;
}
