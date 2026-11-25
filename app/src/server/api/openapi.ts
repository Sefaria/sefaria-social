// The OpenAPI 3.1 document, built from the endpoint contracts (plan section 6.2). Deterministic: the same contracts always
// give the same bytes, so the committed packages/api-client/openapi.json can be compared in CI.
import { z } from "zod";
import { MAX_BODY_BYTES, type EndpointSpec } from "../http/endpoint";
import { ENDPOINTS, ErrorBody } from "./contracts";

type Json = Record<string, unknown>;

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: "The request does not match the schema (request.invalid).",
  401: "No valid credentials (auth.missing_token, auth.invalid_token, auth.user_deleted, webhook.bad_signature).",
  403: "Not allowed for this caller (for example room.forbidden).",
  404: "Not found, or not visible to this caller (for example room.not_found).",
  405: "Method not allowed on this route (method.not_allowed).",
  503: "A dependency is unavailable (auth.unavailable, webhook.unavailable).",
};

/** Raw bytes (spec 041): a binary request body or response. */
const BINARY = { type: "string", format: "binary" } as const;

/** "64 KiB", "4 MiB": a body limit as the error description states it. */
function sizeOf(bytes: number): string {
  if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MiB`;
  if (bytes % 1024 === 0) return `${bytes / 1024} KiB`;
  return `${bytes} bytes`;
}

function bodyLimit(e: EndpointSpec): number {
  return e.binaryBody?.maxBytes ?? e.maxBodyBytes ?? MAX_BODY_BYTES;
}

function schemaOf(schema: z.ZodType, io: "input" | "output"): Json {
  const out = z.toJSONSchema(schema, { io, unrepresentable: "throw" }) as Json;
  delete out.$schema;
  return out;
}

function errorStatuses(e: EndpointSpec & { access: string }): number[] {
  const s = new Set<number>(e.errors ?? []);
  if (e.params || e.query || e.body) s.add(400);
  if (e.body || e.binaryBody) s.add(413);
  if (e.access !== "public") s.add(401).add(503);
  return [...s].filter((code) => !(code in e.responses)).sort((a, b) => a - b);
}

function operation(e: EndpointSpec & { access: string }): Json {
  const op: Json = { operationId: e.operationId, summary: e.summary, tags: [...e.tags] };
  const parameters: Json[] = [];
  if (e.params)
    for (const [name, s] of Object.entries(e.params.shape))
      parameters.push({ name, in: "path", required: true, schema: schemaOf(s as z.ZodType, "input") });
  if (e.query)
    for (const [name, s] of Object.entries(e.query.shape))
      parameters.push({
        name,
        in: "query",
        required: !(s as z.ZodType).safeParse(undefined).success,
        schema: schemaOf(s as z.ZodType, "input"),
      });
  if (parameters.length) op.parameters = parameters;
  if (e.body) op.requestBody = { required: true, content: { "application/json": { schema: schemaOf(e.body, "input") } } };
  if (e.binaryBody) op.requestBody = { required: true, content: { "application/octet-stream": { schema: BINARY } } };
  const responses: Json = {};
  for (const [status, spec] of Object.entries(e.responses))
    responses[status] = spec.binary
      ? { description: spec.description, content: { "application/octet-stream": { schema: BINARY } } }
      : spec.schema
        ? { description: spec.description, content: { "application/json": { schema: schemaOf(spec.schema, "output") } } }
        : { description: spec.description };
  for (const code of errorStatuses(e))
    responses[String(code)] = {
      description:
        code === 413
          ? `The request body is larger than ${sizeOf(bodyLimit(e))} (request.too_large).`
          : (ERROR_DESCRIPTIONS[code] ?? "Error."),
      content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
    };
  op.responses = responses;
  op.security =
    e.access === "user"
      ? [{ sefariaToken: [] }]
      : e.access === "sefaria-webhook"
        ? [{ sefariaSignature: [] }]
        : e.access === "livekit-webhook"
          ? [{ livekitSignature: [] }]
          : [];
  return op;
}

export function buildOpenApi(endpoints: readonly (EndpointSpec & { access: string })[] = ENDPOINTS): Json {
  const paths: Record<string, Json> = {};
  for (const e of endpoints) (paths[e.path] ??= {})[e.method.toLowerCase()] = operation(e);
  return {
    openapi: "3.1.0",
    info: {
      title: "Sefaria Social API",
      version: "1.0.0",
      description:
        "Generated from app/src/server/api/contracts.ts by `npm run api:generate`. Do not edit. Every operation needs a Sefaria identity token unless its security is empty.",
    },
    paths,
    components: {
      schemas: { Error: schemaOf(ErrorBody, "output") },
      securitySchemes: {
        sefariaToken: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Short-lived RS256 token from Django's POST /api/social/token.",
        },
        sefariaSignature: {
          type: "apiKey",
          in: "header",
          name: "X-Sefaria-Signature",
          description: "sha256=<hex HMAC-SHA256 of the raw body>, for Django's webhooks.",
        },
        livekitSignature: {
          type: "apiKey",
          in: "header",
          name: "Authorization",
          description:
            "A JWT signed with the LiveKit API secret whose sha256 claim is the raw body's hash, for LiveKit's webhooks.",
        },
      },
    },
  };
}

export const renderOpenApi = (doc: Json = buildOpenApi()) => `${JSON.stringify(doc, null, 2)}\n`;
