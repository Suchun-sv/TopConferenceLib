/** Strip markdown syntax and return a plain-text preview of at most `n` chars.
 * Server-safe (no "use client") so server components (paper-row / paper-card)
 * can call it during render. */
export function mdTeaser(s: string, n = 200): string {
  let t = s;
  t = t.replace(/^#+\s+/gm, "");                 // heading markers
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");  // links → text
  t = t.replace(/```[\s\S]*?```/g, "");           // fenced code blocks
  t = t.replace(/`[^`]*`/g, "");                  // inline code
  t = t.replace(/[*_>`]/g, "");                   // bold/italic/blockquote
  t = t.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return t.slice(0, n).replace(/[，。,.\s][^，。,.\s]*$/, "") + "…";
}
