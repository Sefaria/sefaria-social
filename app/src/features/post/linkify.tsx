// URLs in a post's text become links (spec 055 AC-004): http and https only, opening a new tab with `noopener nofollow`.
// The text is split into strings and URLs and rendered as React elements; no HTML is ever parsed from it.
import { Fragment } from "react";

export type Token = { kind: "text"; text: string } | { kind: "url"; text: string };

// A URL runs to the next space; closing punctuation at its end is the sentence's, not the URL's.
const URL_RE = /\bhttps?:\/\/[^\s<>"]+/gi;
const TRAILING = /[.,;:!?'")\]}]+$/;

export function linkTokens(text: string): Token[] {
  const out: Token[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(TRAILING, "");
    let valid = false;
    try {
      const u = new URL(url);
      valid = (u.protocol === "http:" || u.protocol === "https:") && u.hostname.length > 0;
    } catch {
      valid = false;
    }
    if (!valid) continue;
    if (m.index > at) out.push({ kind: "text", text: text.slice(at, m.index) });
    out.push({ kind: "url", text: url });
    at = m.index + url.length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

export function Linkified({ text }: { text: string }) {
  return (
    <>
      {linkTokens(text).map((t, i) =>
        t.kind === "url" ? (
          <a key={i} href={t.text} target="_blank" rel="noopener nofollow" data-post-url="">
            {t.text}
          </a>
        ) : (
          <Fragment key={i}>{t.text}</Fragment>
        ),
      )}
    </>
  );
}
