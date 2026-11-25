// The one path every API request takes (plan sections 6.1 and 6.2). A route file binds an endpoint contract to a thin
// handler with `bind`, and hands the bound handlers to TanStack Start with `serve`. The wrapper:
//   1. takes or makes the correlation id;
//   2. checks access BEFORE reading anything else: `user` (the default) needs a verified Sefaria token, `livekit-webhook` a
//      LiveKit-signed Authorization over the raw body (spec 038), `sefaria-webhook`
//      a valid signature over the raw body, `relay-report` the relay's signature over the raw body with RELAY_INTERNAL_SECRET
//      (spec 056), and `public` is allowed only for endpoints on PUBLIC_ENDPOINTS;
//   3. validates path parameters and the body with the contract's zod schemas (400 request.invalid); a binary body
//      (`binaryBody`, spec 041) is read as bytes up to its cap (413 request.too_large), never parsed;
//   4. validates the handler's response against the contract, so nothing undeclared leaves the server; a `binary` response
//      is written as is with the content type the handler names; a handler may add response headers (`headers`, for example
//      an ETag and its cache-control, spec 056), and a status declared without a schema (204, 304) has no body;
//   5. maps errors to { error: { code, message } } and writes exactly one log line, without headers, body or token;
//   6. adds CORS headers for an allowed Origin (./cors.ts); a CORS preflight (OPTIONS) is answered without a token.
// Protect by default: there is no way to skip step 2, and a method a route does not declare answers 401/405 the same way.
import type { z } from "zod";
import { authenticate } from "../auth/authenticate";
import type { Identity } from "../auth/identity";
import { getConfig } from "../config";
import { log } from "../log/logger";
import { SIGNATURE_HEADER, verifySignature } from "../webhooks/signature";
import { verifyLivekitWebhook } from "../services/livekit";
import { CORRELATION_HEADER, correlationIdFrom } from "./correlation";
import { corsHeaders, preflight } from "./cors";
import { ApiError, errorBody } from "./errors";
import { PUBLIC_ENDPOINTS } from "./public-routes";

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Method = (typeof METHODS)[number];
export type Access = "user" | "public" | "sefaria-webhook" | "livekit-webhook" | "relay-report";
export const MAX_BODY_BYTES = 64 * 1024;
/** The relay's signature over a live report's raw body: `sha256=<hex HMAC-SHA256>` with RELAY_INTERNAL_SECRET (spec 056). */
export const RELAY_SIGNATURE_HEADER = "x-relay-signature";

export interface ResponseSpec {
  description: string;
  schema?: z.ZodType;
  /** The body is raw bytes (spec 041): the handler returns `{ status, body: Uint8Array, contentType }`. */
  binary?: true;
}

export interface EndpointSpec {
  operationId: string;
  method: Method;
  /** OpenAPI-style path, for example "/api/v1/rooms/{roomId}". */
  path: `/api/${string}`;
  summary: string;
  tags: readonly string[];
  /** Defaults to "user": a verified Sefaria identity. */
  access?: Access;
  params?: z.ZodObject;
  /** Search parameters (each a string or absent); validated like params, unknown ones rejected by a strict schema. */
  query?: z.ZodObject;
  body?: z.ZodType;
  /** The JSON body's size limit in bytes, when it is not MAX_BODY_BYTES (for example a recording's state batch). */
  maxBodyBytes?: number;
  /** The body is raw bytes (application/octet-stream) of at most `maxBytes`; the handler gets them as `bytes`. */
  binaryBody?: { maxBytes: number };
  /** Responses the handler returns. Error responses are added by the OpenAPI generator from `access`, inputs and `errors`. */
  responses: Readonly<Record<number, ResponseSpec>>;
  /** Extra error statuses the handler can throw (as ApiError), for the OpenAPI document; for example [403, 404]. */
  errors?: readonly number[];
}

type AccessOf<S extends EndpointSpec> = S["access"] extends Access ? S["access"] : "user";

export interface HandlerInput<S extends EndpointSpec> {
  params: S["params"] extends z.ZodType ? z.output<S["params"]> : Record<string, never>;
  query: S["query"] extends z.ZodType ? z.output<S["query"]> : Record<string, never>;
  body: S["body"] extends z.ZodType ? z.output<S["body"]> : undefined;
  bytes: S["binaryBody"] extends { maxBytes: number } ? Uint8Array : undefined;
  identity: AccessOf<S> extends "user" ? Identity : undefined;
  correlationId: string;
  request: Request;
}

export type HandlerResult<S extends EndpointSpec> = {
  [K in keyof S["responses"] & number]: S["responses"][K]["binary"] extends true
    ? { status: K; body: Uint8Array; contentType: string }
    : {
        status: K;
        body: S["responses"][K]["schema"] extends z.ZodType ? z.input<S["responses"][K]["schema"]> : undefined;
        /** Response headers the handler adds (only these names: cache validators, never anything about the caller). */
        headers?: Partial<Record<ResponseHeader, string>>;
      };
}[keyof S["responses"] & number];

/** The headers a handler may set. A short list on purpose: CORS, the correlation id and content type stay the wrapper's. */
export type ResponseHeader = "etag" | "cache-control";

/** What Start passes to a server-route handler (the parts we use). */
export interface RouteCtx {
  request: Request;
  params: Record<string, string>;
}

export type BoundHandler = ((ctx: RouteCtx) => Promise<Response>) & { endpoint: EndpointSpec & { access: Access } };

/** Declare an endpoint. Throws at module load when it claims `public` without being on the public list. */
export function defineEndpoint<const S extends EndpointSpec>(spec: S): S & { access: AccessOf<S> } {
  const access = (spec.access ?? "user") as AccessOf<S>;
  const key = `${spec.method} ${spec.path}`;
  if (access === "public" && !PUBLIC_ENDPOINTS.has(key))
    throw new Error(
      `Endpoint ${spec.operationId} (${key}) is declared public but is not on PUBLIC_ENDPOINTS (app/src/server/http/public-routes.ts). ` +
        `Fix: remove access: "public" so it requires a signed-in user, or add it to the public list with a reason for the reviewer.`,
    );
  return { ...spec, access };
}

function json(status: number, body: unknown, correlationId: string, extra: Record<string, string> = {}): Response {
  const headers = { "cache-control": "no-store", [CORRELATION_HEADER]: correlationId, ...extra };
  if (status === 204 || status === 304 || body === undefined) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json" } });
}

/** A binary response (spec 041): the bytes as they are, with the handler's content type. */
function bytesResponse(
  status: number,
  body: Uint8Array,
  contentType: string,
  correlationId: string,
  extra: Record<string, string>,
): Response {
  const headers = {
    "cache-control": "no-store",
    [CORRELATION_HEADER]: correlationId,
    ...extra,
    "content-type": contentType,
    "content-length": String(body.byteLength),
  };
  return new Response(body as Uint8Array<ArrayBuffer>, { status, headers });
}

/** The body as bytes, refused (413) as soon as it passes `max`: a declared length is checked first, then the stream itself. */
async function readBytes(request: Request, max: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > max) throw new ApiError(413, "request.too_large");
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new ApiError(413, "request.too_large");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

async function readRaw(request: Request, max: number = MAX_BODY_BYTES): Promise<string> {
  return new TextDecoder().decode(await readBytes(request, max));
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, "request.invalid");
  }
}

function validate<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "request.invalid");
  return parsed.data;
}

async function checkAccess(access: Access, request: Request): Promise<{ identity?: Identity; raw?: string }> {
  if (access === "public") return {};
  if (access === "user") return { identity: await authenticate(request) };
  if (access === "relay-report") {
    // The relay's live reports (spec 056): no signature is a plain 401, before anything else, so the route is protected by
    // default even where the secret is not configured.
    const header = request.headers.get(RELAY_SIGNATURE_HEADER);
    if (!header) throw new ApiError(401, "webhook.bad_signature");
    const secret = getConfig().RELAY_INTERNAL_SECRET;
    if (!secret) {
      log.error("webhook.not_configured");
      throw new ApiError(503, "webhook.unavailable");
    }
    const raw = await readRaw(request);
    if (!verifySignature(secret, raw, header)) throw new ApiError(401, "webhook.bad_signature");
    return { raw };
  }
  if (access === "livekit-webhook") {
    const raw = await readRaw(request);
    const ok = await verifyLivekitWebhook(raw, request.headers.get("authorization"));
    if (ok === "unconfigured") {
      log.error("webhook.not_configured");
      throw new ApiError(503, "webhook.unavailable");
    }
    if (!ok) throw new ApiError(401, "webhook.bad_signature");
    return { raw };
  }
  const secret = getConfig().USER_DELETED_WEBHOOK_SECRET;
  if (!secret) {
    log.error("webhook.not_configured");
    throw new ApiError(503, "webhook.unavailable");
  }
  const raw = await readRaw(request);
  if (!verifySignature(secret, raw, request.headers.get(SIGNATURE_HEADER))) throw new ApiError(401, "webhook.bad_signature");
  return { raw };
}

async function run(
  method: string,
  route: string,
  ctx: RouteCtx,
  inner: (
    correlationId: string,
  ) => Promise<{ status: number; body: unknown; contentType?: string; headers?: Record<string, string> }>,
): Promise<Response> {
  const started = performance.now();
  const correlationId = correlationIdFrom(ctx.request.headers.get(CORRELATION_HEADER));
  const cors = corsHeaders(ctx.request);
  let status = 500;
  try {
    const result = await inner(correlationId);
    status = result.status;
    if (result.contentType !== undefined && result.body instanceof Uint8Array)
      return bytesResponse(result.status, result.body, result.contentType, correlationId, cors);
    return json(result.status, result.body, correlationId, { ...result.headers, ...cors });
  } catch (e) {
    if (e instanceof ApiError) {
      status = e.status;
      return json(e.status, errorBody(e.code), correlationId, { ...e.headers, ...cors });
    }
    log.error("request.failed", {
      method,
      route,
      correlation_id: correlationId,
      error: e instanceof Error ? e.name : "unknown",
    });
    status = 500;
    return json(500, errorBody("internal"), correlationId, cors);
  } finally {
    log.info("request.completed", {
      method,
      route,
      status,
      duration_ms: Math.round(performance.now() - started),
      correlation_id: correlationId,
    });
  }
}

/** Bind a contract to its handler. The handler only ever sees validated input from an allowed caller. */
export function bind<const S extends EndpointSpec & { access: Access }>(
  spec: S,
  handler: (input: HandlerInput<S>) => Promise<HandlerResult<S>>,
): BoundHandler {
  const fn = (ctx: RouteCtx) =>
    run(spec.method, spec.path, ctx, async (correlationId) => {
      const { identity, raw } = await checkAccess(spec.access, ctx.request);
      const params = spec.params ? validate(spec.params, ctx.params ?? {}) : {};
      const query = spec.query ? validate(spec.query, Object.fromEntries(new URL(ctx.request.url).searchParams)) : {};
      let body: unknown;
      if (spec.body) body = validate(spec.body, parseJson(raw ?? (await readRaw(ctx.request, spec.maxBodyBytes))));
      const bytes = spec.binaryBody ? await readBytes(ctx.request, spec.binaryBody.maxBytes) : undefined;
      const result = (await handler({
        params,
        query,
        body,
        bytes,
        identity,
        correlationId,
        request: ctx.request,
      } as HandlerInput<S>)) as {
        status: number;
        body: unknown;
        contentType?: unknown;
        headers?: Partial<Record<ResponseHeader, string>>;
      };
      const headers = pickHeaders(result.headers);
      const declared = spec.responses[result.status];
      if (!declared) throw new Error(`Undeclared status ${result.status} from ${spec.operationId}`);
      if (declared.binary) {
        if (!(result.body instanceof Uint8Array) || typeof result.contentType !== "string")
          throw new TypeError(`Response of ${spec.operationId} is not bytes with a content type`);
        return { status: result.status, body: result.body, contentType: result.contentType };
      }
      if (!declared.schema) return { status: result.status, body: undefined, headers };
      const out = declared.schema.safeParse(result.body);
      if (!out.success) throw new TypeError(`Response of ${spec.operationId} does not match its schema`);
      return { status: result.status, body: out.data, headers };
    });
  return Object.assign(fn, { endpoint: spec });
}

const RESPONSE_HEADERS: readonly ResponseHeader[] = ["etag", "cache-control"];

/** Only the allowed header names, with string values. */
function pickHeaders(given: Partial<Record<ResponseHeader, string>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of RESPONSE_HEADERS) if (typeof given?.[name] === "string") out[name] = given[name]!;
  return out;
}

export type ServerHandlers = Partial<Record<Method, BoundHandler>> & { ANY: (ctx: RouteCtx) => Promise<Response> };

/**
 * The `server.handlers` of one route file. Every handler must come from `bind`, and all must share one path. A method the
 * route does not declare is not on the public list, so it needs a verified identity (401) before it learns 405.
 */
export function serve(handlers: Partial<Record<Method, BoundHandler>>): ServerHandlers {
  const bound = Object.entries(handlers) as [Method, BoundHandler][];
  const paths = new Set(bound.map(([, h]) => h.endpoint.path));
  if (bound.length === 0 || paths.size !== 1) throw new Error("serve() needs bound handlers that share one path");
  for (const [method, h] of bound)
    if (typeof h.endpoint !== "object" || h.endpoint.method !== method)
      throw new Error(`serve(): the ${method} handler must be bind(<endpoint for ${method}>, …)`);
  const path = [...paths][0]!;
  const declared = bound.map(([m]) => m);
  const ANY = (ctx: RouteCtx) =>
    ctx.request.method === "OPTIONS"
      ? Promise.resolve(preflight(ctx.request, declared))
      : run(ctx.request.method, path, ctx, async () => {
          await authenticate(ctx.request);
          throw new ApiError(405, "method.not_allowed");
        });
  return { ...handlers, ANY };
}

/** A handler result with its status kept as a literal type (so it is checked against the contract's responses). */
export const reply = <const S extends number, B>(status: S, body: B, headers?: Partial<Record<ResponseHeader, string>>) =>
  headers ? { status, body, headers } : { status, body };
