// The `ctx` codec (plan 4.4, routing rules R3 and R11). The reader keeps one reserved URL parameter, `ctx`, whose value is
// `<namespace>.<rest>`. Social owns only values that start with `social.`: `social.room.<roomId>` and `social.shiur.<shiurId>`.
// These functions read and write that one parameter and leave every other parameter of a reader URL exactly as written.
import { z } from "zod";
import { ID_RE, type Id } from "./ids";

export const CTX_PARAM = "ctx";
export const SOCIAL_NAMESPACE = "social";

/** The host's grammar for any ctx value (plan 4.4). */
export const CTX_VALUE_RE = /^[a-z][a-z0-9]*\.[A-Za-z0-9_.-]{1,160}$/;

export const socialContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("room"), id: z.string().regex(ID_RE) }),
  z.object({ kind: z.literal("shiur"), id: z.string().regex(ID_RE) }),
]);
/** A room or shiur that a reader URL can be "in". */
export type SocialContext = { kind: "room"; id: Id } | { kind: "shiur"; id: Id };

const SOCIAL_VALUE_RE = new RegExp(`^${SOCIAL_NAMESPACE}\\.(room|shiur)\\.(${ID_RE.source.slice(1, -1)})$`);

/** `social.room.<id>` or `social.shiur.<id>`. Throws on an invalid context, which is a programming error. */
export function encodeCtx(context: SocialContext): string {
  const parsed = socialContextSchema.parse(context);
  return `${SOCIAL_NAMESPACE}.${parsed.kind}.${parsed.id}`;
}

/** The social context in a ctx value, or null for a value that is malformed, from another namespace, or not a string. */
export function decodeCtx(value: unknown): SocialContext | null {
  if (typeof value !== "string" || !CTX_VALUE_RE.test(value)) return null;
  const m = SOCIAL_VALUE_RE.exec(value);
  if (!m) return null;
  return { kind: m[1] as SocialContext["kind"], id: m[2] as Id };
}

/** True when `value` is a ctx value social owns (starts with `social.` and decodes). */
export const isSocialCtx = (value: unknown): boolean => decodeCtx(value) !== null;

interface SplitUrl {
  path: string;
  params: string[];
  hash: string;
}

function split(url: string): SplitUrl {
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const queryAt = beforeHash.indexOf("?");
  const path = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  const query = queryAt >= 0 ? beforeHash.slice(queryAt + 1) : "";
  return { path, params: query ? query.split("&").filter(Boolean) : [], hash };
}

const join = ({ path, params, hash }: SplitUrl) => `${path}${params.length ? `?${params.join("&")}` : ""}${hash}`;
const keyOf = (param: string) => {
  const i = param.indexOf("=");
  return (i < 0 ? param : param.slice(0, i)).replace(/\+/g, " ");
};
const valueOf = (param: string) => {
  const i = param.indexOf("=");
  return i < 0 ? "" : param.slice(i + 1);
};

/** The social context of a reader URL (path + search, or just the search string), or null. */
export function readCtx(urlOrSearch: string): SocialContext | null {
  const queryAt = urlOrSearch.indexOf("?");
  if (queryAt < 0) return null;
  const param = split(urlOrSearch.slice(queryAt)).params.find((p) => keyOf(p) === CTX_PARAM);
  return param === undefined ? null : decodeCtx(valueOf(param));
}

/**
 * `url` with `ctx=<social context>` (R9: entering a room or shiur). Any earlier ctx is replaced; every other parameter, the
 * path and the hash are kept byte for byte (R3).
 */
export function withCtx(url: string, context: SocialContext): string {
  const parts = split(url);
  return join({
    ...parts,
    params: [...parts.params.filter((p) => keyOf(p) !== CTX_PARAM), `${CTX_PARAM}=${encodeCtx(context)}`],
  });
}

/** `url` without social's ctx (R12: leaving). A ctx from another namespace is not social's and is kept. */
export function withoutCtx(url: string): string {
  const parts = split(url);
  return join({ ...parts, params: parts.params.filter((p) => !(keyOf(p) === CTX_PARAM && isSocialCtx(valueOf(p)))) });
}
