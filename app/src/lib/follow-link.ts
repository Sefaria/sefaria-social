// Follow-me links (spec 032). The reader's follow me shares its live session as an ordinary reader address with
// `follow=<session id>` on it (reader-next/src/features/reader-state/follow/params.ts). A post may carry one: the post then
// shows where the session is now and lets a learner join it. Everything here is pure and shared by the server (reading a
// new post) and the card (building the join address).

/** A session id is 256 random bits in base62, 43 characters (reader-next/src/lib/session/ids.ts). It is the join capability. */
export const SESSION_ID_RE = /^[0-9A-Za-z]{43}$/;
export const FOLLOW_PARAM = "follow";

export const isFollowSessionId = (s: unknown): s is string => typeof s === "string" && SESSION_ID_RE.test(s);

export interface FollowLink {
  sessionId: string;
  /** The ref the address opened on when it was shared ("Genesis 1:1"); null for an address that is not a text. */
  ref: string | null;
}

const ADDRESS = String.raw`\d+[a-d]?`;
const SECTIONS = String.raw`${ADDRESS}(?:[.:]${ADDRESS})*`;
const URL_SECTIONS_RE = new RegExp(String.raw`^(.*?)\.(${SECTIONS}(?:-${SECTIONS})?)$`);

/**
 * The human ref a reader address names, from its first path segment, the way the reader writes refs into addresses
 * (`Ref.url()`: spaces to `_`, `:` to `.`, the space before the sections to `.`): "/Genesis.1.1-5?lang=bi" is
 * "Genesis 1:1-5", "/Mishnah_Berakhot.2" is "Mishnah Berakhot 2". Null for the home page, a non-path, or something that is
 * not text-shaped (a sheet, a topic, the social pages).
 */
export function refFromReaderUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let path = url;
  if (/^https?:\/\//i.test(url)) {
    try {
      path = new URL(url).pathname;
    } catch {
      return null;
    }
  }
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  const first = path.split(/[?#]/, 1)[0]!.split("/").filter(Boolean)[0];
  if (!first || /^(social|sheets|topics|texts|search|static|api|login|register|settings)$/i.test(first)) return null;
  let segment: string;
  try {
    segment = decodeURIComponent(first);
  } catch {
    return null;
  }
  const m = URL_SECTIONS_RE.exec(segment);
  const title = (m ? m[1]! : segment).replace(/_/g, " ").trim();
  if (!title || title.length > 200 || /[<>"]/.test(title)) return null;
  if (!m) return title;
  const [start = "", end] = m[2]!.split("-");
  const human = (s: string) => s.split(".").filter(Boolean).join(":");
  return `${title} ${human(start)}${end ? `-${human(end)}` : ""}`.slice(0, 200);
}

/** The session id in an address's `follow` parameter, if it is shaped like one (anything else is ignored). */
function followParamOf(search: string): string | null {
  for (const pair of search.replace(/^\?/, "").split("&")) {
    if (!pair.startsWith(`${FOLLOW_PARAM}=`)) continue;
    const value = pair.slice(FOLLOW_PARAM.length + 1);
    if (isFollowSessionId(value)) return value;
  }
  return null;
}

/** One address (absolute, or a path) as a follow link, or null. */
export function parseFollowLink(candidate: string): FollowLink | null {
  const text = candidate.trim();
  let pathAndQuery: string;
  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text);
      pathAndQuery = `${u.pathname}${u.search}`;
    } catch {
      return null;
    }
  } else if (text.startsWith("/")) pathAndQuery = text;
  else return null;
  const q = pathAndQuery.indexOf("?");
  if (q < 0) return null;
  const sessionId = followParamOf(pathAndQuery.slice(q).split("#", 1)[0]!);
  if (!sessionId) return null;
  return { sessionId, ref: refFromReaderUrl(pathAndQuery) };
}

/** The first follow link in a piece of text (a post's body), or null. */
export function findFollowLink(text: string): FollowLink | null {
  for (const m of text.matchAll(/(?:https?:\/\/|(?<=^|\s)\/)[^\s<>"]+/gi)) {
    const link = parseFollowLink(m[0].replace(/[).,;:!?]+$/, ""));
    if (link) return link;
  }
  return null;
}

/** `href` with `follow=<id>` in place of any earlier one; the hash stays last (the reader's withFollowParam). */
export function withFollowParam(href: string, sessionId: string): string {
  const hashAt = href.indexOf("#");
  const hash = hashAt >= 0 ? href.slice(hashAt) : "";
  const beforeHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const queryAt = beforeHash.indexOf("?");
  const base = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  const kept = (queryAt >= 0 ? beforeHash.slice(queryAt + 1) : "")
    .split("&")
    .filter((p) => p !== "" && p !== FOLLOW_PARAM && !p.startsWith(`${FOLLOW_PARAM}=`));
  return `${base}?${[...kept, `${FOLLOW_PARAM}=${sessionId}`].join("&")}${hash}`;
}
