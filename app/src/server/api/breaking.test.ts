// Each breaking-change rule with its negative (fires) and positive (a compatible change passes) case.
import { describe, expect, it } from "vitest";
import { breakingChanges, verdict } from "./breaking";

const room = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    role: { type: "string", enum: ["owner", "member"] },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["id", "title", "role"],
};
const input = { type: "object", properties: { title: { type: "string" } }, required: ["title"] };
const json = (schema: unknown) => ({ content: { "application/json": { schema } } });
const doc = (
  r: unknown = room,
  i: unknown = input,
  params: unknown[] = [{ name: "roomId", in: "path", required: true, schema: { type: "string" } }],
) => ({
  openapi: "3.1.0",
  paths: {
    "/api/v1/rooms/{roomId}": {
      get: { parameters: params, responses: { "200": { description: "x", ...json(r) } } },
      patch: {
        parameters: params,
        requestBody: { required: true, ...json(i) },
        responses: { "200": { description: "x", ...json(r) } },
      },
    },
  },
});
const clone = <T>(v: T): T => structuredClone(v);
const rules = (base: unknown, head: unknown) =>
  breakingChanges(base as Record<string, unknown>, head as Record<string, unknown>).map((c) => `${c.rule} ${c.where}`);

describe("breakingChanges", () => {
  it("finds nothing between equal documents", () => {
    expect(rules(doc(), doc())).toEqual([]);
  });

  it("operation-removed", () => {
    const head = doc() as { paths: Record<string, Record<string, unknown>> };
    delete head.paths["/api/v1/rooms/{roomId}"]!.patch;
    expect(rules(doc(), head)).toEqual(["operation-removed PATCH /api/v1/rooms/{roomId}"]);
  });

  it("response-property-removed", () => {
    const r = clone(room) as unknown as { properties: Record<string, unknown>; required: string[] };
    delete r.properties.title;
    r.required = ["id", "role"];
    expect(rules(doc(), doc(r))).toEqual([
      "response-property-removed GET /api/v1/rooms/{roomId} 200 response.title",
      "response-property-removed PATCH /api/v1/rooms/{roomId} 200 response.title",
    ]);
  });

  it("response-property-optional", () => {
    const r = { ...clone(room), required: ["id", "role"] };
    expect(rules(doc(), doc(r))).toContain("response-property-optional GET /api/v1/rooms/{roomId} 200 response.title");
  });

  it("response-enum-widened", () => {
    const r = clone(room);
    r.properties.role.enum = ["owner", "member", "guest"];
    expect(rules(doc(), doc(r))).toContain("response-enum-widened GET /api/v1/rooms/{roomId} 200 response.role");
  });

  it("type-changed in a response and in an array's items", () => {
    const r = clone(room) as unknown as { properties: Record<string, Record<string, unknown>> };
    r.properties.title = { type: "integer" };
    r.properties.tags!.items = { type: "number" };
    expect(rules(doc(), doc(r))).toEqual(
      expect.arrayContaining([
        "type-changed GET /api/v1/rooms/{roomId} 200 response.title",
        "type-changed GET /api/v1/rooms/{roomId} 200 response.tags[]",
      ]),
    );
  });

  it("request-required-added", () => {
    const i = {
      type: "object",
      properties: { title: { type: "string" }, slug: { type: "string" } },
      required: ["title", "slug"],
    };
    expect(rules(doc(), doc(room, i))).toEqual(["request-required-added PATCH /api/v1/rooms/{roomId} body.slug"]);
  });

  it("param-added-required", () => {
    const params = [
      { name: "roomId", in: "path", required: true, schema: { type: "string" } },
      { name: "v", in: "query", required: true, schema: { type: "string" } },
    ];
    expect(rules(doc(), doc(room, input, params))).toContain("param-added-required GET /api/v1/rooms/{roomId} query parameter v");
  });

  it("allows compatible changes: a new optional request field, a new response field, a new operation", () => {
    const i = { ...clone(input), properties: { title: { type: "string" }, note: { type: "string" } } };
    const r = clone(room) as unknown as { properties: Record<string, unknown> };
    r.properties.createdAt = { type: "string" };
    const head = doc(r, i) as { paths: Record<string, unknown> };
    head.paths["/api/v1/rooms"] = { get: { responses: { "200": { description: "x" } } } };
    expect(rules(doc(), head)).toEqual([]);
  });

  it("allows a request field to accept more types", () => {
    const i = { ...clone(input), properties: { title: { type: ["string", "null"] } } };
    expect(rules(doc(), doc(room, i))).toEqual([]);
  });
});

describe("verdict", () => {
  const change = { rule: "operation-removed" as const, where: "GET /x", message: "GET /x: operation removed" };
  it("fails on a breaking change", () => {
    expect(verdict([change], [{ id: "009", contractImpact: "api-minor" }]).ok).toBe(false);
  });
  it("passes with a notice when a changed spec declares api-major", () => {
    const v = verdict([change], [{ id: "009", contractImpact: "api-major" }]);
    expect(v.ok).toBe(true);
    expect(v.lines[0]).toContain("declared by spec(s) 009");
  });
  it("passes with nothing to report", () => {
    expect(verdict([], [])).toEqual({ ok: true, lines: ["api-breaking: PASS (no breaking changes)"] });
  });
});
