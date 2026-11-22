/**
 * Query strings the way the reader writes them (routing rule R7), so the host's router and social's router read the same
 * address the same way. Ported from the reader's `src/lib/reader/search-serializer.ts`:
 *  - values are strings (numbers are written as-is); nothing is JSON-quoted (TanStack's default would write "1" as %221%22);
 *  - `+` is a space; spaces are written as `+` and a literal plus as %2B;
 *  - `|`, `,`, `:`, `[` and `]` stay readable.
 * Both of social's routers (the Start router and the surface router) use these two functions.
 */
export function parseSearch(searchStr: string): Record<string, string> {
  const out: Record<string, string> = {};
  const s = searchStr.startsWith("?") ? searchStr.slice(1) : searchStr;
  if (!s) return out;
  for (const part of s.split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const k = safeDecode((i < 0 ? part : part.slice(0, i)).replace(/\+/g, " "));
    const v = i < 0 ? "" : safeDecode(part.slice(i + 1).replace(/\+/g, " "));
    if (k && !(k in out)) out[k] = v;
  }
  return out;
}

export function stringifySearch(search: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(search)) {
    if (v === undefined || v === null) continue;
    const value = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
    parts.push(`${encode(k)}=${encode(value)}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

const encode = (s: string) =>
  encodeURIComponent(s)
    .replace(/%20/g, "+")
    .replace(/%7C/gi, "|")
    .replace(/%2C/gi, ",")
    .replace(/%3A/gi, ":")
    .replace(/%5B/gi, "[")
    .replace(/%5D/gi, "]");

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s; // a malformed escape is kept as written rather than dropping the parameter
  }
}
