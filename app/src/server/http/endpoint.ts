// The one path every API request takes (plan sections 6.1 and 6.2). A route file binds an endpoint contract to a thin
// handler with `bind`, and hands the bound handlers to TanStack Start with `serve`. The wrapper:
//   1. takes or makes the correlation id;
//   2. checks access BEFORE reading anything else: `user` (the default) needs a verified Sefaria token, `sefaria-webhook`
//      a valid signature over the raw body, and `public` is allowed only for endpoints on PUBLIC_ENDPOINTS;
//   3. validates path parameters and the body with the contract's zod schemas (400 request.invalid);
//   4. validates the handler's response against the contract, so nothing undeclared leaves the server;
//   5. maps errors to { error: { code, message } } and writes exactly one log line, without headers, body or token.
// Protect by default: there is no way to skip step 2, and a method a route does not declare answers 401/405 the same way.
import type { z } from "zod";
import { authenticate } from "../auth/authenticate";
import type { Identity } from "../auth/identity";
import { getConfig } from "../config";
import { log } from "../log/logger";
import { SIGNATURE_HEADER, verifySignature } from "../webhooks/signature";
import { CORRELATION_HEADER, correlationIdFrom } from "./correlation";
import { ApiError, errorBody } from "./errors";
import { PUBLIC_ENDPOINTS } from "./public-routes";

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Method = (typeof METHODS)[number];
export type Access = "user" | "public" | "sefaria-webhook";
export const MAX_BODY_BYTES = 64 * 1024;

export interface ResponseSpec {
  description: string;
  schema?: z.ZodType;
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
  body?: z.ZodType;
  /** Responses the handler returns. Error responses are added by the OpenAPI generator from `access`, inputs and `errors`. */
  responses: Readonly<Record<number, ResponseSpec>>;
  /** Extra error statuses the handler can throw (as ApiError), for the OpenAPI document; for example [403, 404]. */
  errors?: readonly number[];
}

type AccessOf<S extends EndpointSpec> = S["access"] extends Access ? S["access"] : "user";

export interface HandlerInput<S extends EndpointSpec> {
  params: S["params"] extends z.ZodType ? z.output<S["params"]> : Record<string, never>;
  body: S["body"] extends z.ZodType ? z.output<S["body"]> : undefined;
  identity: AccessOf<S> extends "user" ? Identity : undefined;
  correlationId: string;
  request: Request;
}

export type HandlerResult<S extends EndpointSpec> = {
  [K in keyof S["responses"] & number]: {
    status: K;
    body: S["responses"][K]["schema"] extends z.ZodType ? z.input<S["responses"][K]["schema"]> : undefined;
  };
}[keyof S["responses"] & number];

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

function json(status: number, body: unknown, correlationId: string): Response {
  const headers = { "cache-control": "no-store", [CORRELATION_HEADER]: correlationId };
  if (status === 204 || body === undefined) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json" } });
}

async function readRaw(request: Request): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, "request.too_large");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new ApiError(413, "request.too_large");
  return text;
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
  inner: (correlationId: string) => Promise<{ status: number; body: unknown }>,
): Promise<Response> {
  const started = performance.now();
  const correlationId = correlationIdFrom(ctx.request.headers.get(CORRELATION_HEADER));
  let status = 500;
  try {
    const result = await inner(correlationId);
    status = result.status;
    return json(result.status, result.body, correlationId);
  } catch (e) {
    if (e instanceof ApiError) {
      status = e.status;
      return json(e.status, errorBody(e.code), correlationId);
    }
    log.error("request.failed", {
      method,
      route,
      correlation_id: correlationId,
      error: e instanceof Error ? e.name : "unknown",
    });
    status = 500;
    return json(500, errorBody("internal"), correlationId);
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
      let body: unknown;
      if (spec.body) body = validate(spec.body, parseJson(raw ?? (await readRaw(ctx.request))));
      const result = (await handler({ params, body, identity, correlationId, request: ctx.request } as HandlerInput<S>)) as {
        status: number;
        body: unknown;
      };
      const declared = spec.responses[result.status];
      if (!declared) throw new Error(`Undeclared status ${result.status} from ${spec.operationId}`);
      if (!declared.schema) return { status: result.status, body: undefined };
      const out = declared.schema.safeParse(result.body);
      if (!out.success) throw new TypeError(`Response of ${spec.operationId} does not match its schema`);
      return { status: result.status, body: out.data };
    });
  return Object.assign(fn, { endpoint: spec });
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
  const ANY = (ctx: RouteCtx) =>
    run(ctx.request.method, path, ctx, async () => {
      await authenticate(ctx.request);
      throw new ApiError(405, "method.not_allowed");
    });
  return { ...handlers, ANY };
}

/** A handler result with its status kept as a literal type (so it is checked against the contract's responses). */
export const reply = <const S extends number, B>(status: S, body: B) => ({ status, body });
