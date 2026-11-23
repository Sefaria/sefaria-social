// CORS for the surface (spec 011): the surface runs on the reader's origin (www.sefaria.org) and calls this API on another, so
// browsers need the API's permission. Only origins listed in SOCIAL_ALLOWED_ORIGINS get it; no credentials (cookies) are
// allowed, since the API authenticates with a Bearer token. Every other origin gets no CORS headers at all.
import { getConfig } from "../config";
import { CORRELATION_HEADER } from "./correlation";

/** The configured origins, exact match only. */
function allowedOrigins(): Set<string> {
  return new Set(
    (getConfig().SOCIAL_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Headers to add to a response for this request's Origin; empty when the origin is not allowed. */
export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins().has(origin)) return {};
  return { "access-control-allow-origin": origin, vary: "Origin", "access-control-expose-headers": CORRELATION_HEADER };
}

/** The answer to a CORS preflight: 204, with permission only for an allowed origin. Needs no token (browsers send none). */
export function preflight(request: Request, methods: readonly string[]): Response {
  const base = corsHeaders(request);
  const headers: Record<string, string> = { "cache-control": "no-store", ...base };
  if (base["access-control-allow-origin"]) {
    headers["access-control-allow-methods"] = methods.join(", ");
    headers["access-control-allow-headers"] = `authorization, content-type, ${CORRELATION_HEADER}`;
    headers["access-control-max-age"] = "600";
  }
  return new Response(null, { status: 204, headers });
}
