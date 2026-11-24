// Acceptance tests for spec 007: the OpenAPI document, the generated client types and the breaking-change check.
// @feature API-007 OpenAPI document, generated client and breaking-change check
import { describe, expect, it } from "vitest";

const generators = import.meta.glob("./server/api/openapi.ts");
const breakingModules = import.meta.glob("./server/api/breaking.ts");

describe("spec 007: API contract", () => {
  // @ac 007/AC-006
  it("keeps the committed OpenAPI document and client types equal to the generated ones", async () => {
    expect(Object.keys(generators), "the OpenAPI generator").toEqual(["./server/api/openapi.ts"]);
    const { generated, committed } = await import("../scripts/openapi");
    const fresh = await generated();
    const onDisk = committed();
    expect(onDisk.openapi, "packages/api-client/openapi.json is stale. Fix: npm run api:generate, then commit").toBe(
      fresh.openapi,
    );
    expect(onDisk.schema, "packages/api-client/src/schema.ts is stale. Fix: npm run api:generate, then commit").toBe(
      fresh.schema,
    );
    const doc = JSON.parse(fresh.openapi) as {
      paths: Record<string, Record<string, { operationId: string; security: unknown[] }>>;
    };
    const ops = Object.entries(doc.paths).flatMap(([p, item]) =>
      Object.entries(item).map(
        ([m, op]) => `${m.toUpperCase()} ${p} ${op.operationId} ${op.security.length ? "secured" : "public"}`,
      ),
    );
    expect(ops.sort()).toEqual([
      "DELETE /api/v1/posts/{postId} deletePost secured",
      "DELETE /api/v1/posts/{postId}/reaction removeReaction secured",
      "DELETE /api/v1/posts/{postId}/repost removeRepost secured",
      "DELETE /api/v1/profiles/{profileId}/follow unfollowProfile secured",
      "DELETE /api/v1/replies/{replyId} deleteReply secured",
      "DELETE /api/v1/rooms/{roomId} deleteRoom secured",
      "DELETE /api/v1/rooms/{roomId}/members/me leaveRoom secured",
      "GET /api/v1/feed getFeed secured",
      "GET /api/v1/health getHealth public",
      "GET /api/v1/me getMe secured",
      "GET /api/v1/notifications listNotifications secured",
      "GET /api/v1/posts/{postId} getPost secured",
      "GET /api/v1/profiles listProfiles secured",
      "GET /api/v1/profiles/me getMyProfile secured",
      "GET /api/v1/profiles/{profileId} getProfile secured",
      "GET /api/v1/rooms listRooms secured",
      "GET /api/v1/rooms/{roomId} getRoom secured",
      "GET /api/v1/rooms/{roomId}/status getRoomStatus secured",
      "GET /api/v1/timeline getTimeline secured",
      "PATCH /api/v1/profiles/me updateMyProfile secured",
      "PATCH /api/v1/rooms/{roomId} renameRoom secured",
      "POST /api/v1/internal/user-deleted userDeletedWebhook secured",
      "POST /api/v1/notifications/read readNotifications secured",
      "POST /api/v1/posts createPost secured",
      "POST /api/v1/posts/{postId}/replies createReply secured",
      "POST /api/v1/rooms createRoom secured",
      "POST /api/v1/rooms/{roomId}/members joinRoom secured",
      "PUT /api/v1/posts/{postId}/reaction addReaction secured",
      "PUT /api/v1/posts/{postId}/repost addRepost secured",
      "PUT /api/v1/profiles/{profileId}/follow followProfile secured",
    ]);
  });

  // @ac 007/AC-007
  it("fails a breaking change unless a changed spec declares api-major", async () => {
    expect(Object.keys(breakingModules), "the breaking-change check").toEqual(["./server/api/breaking.ts"]);
    const { breakingChanges, verdict } = (await breakingModules[
      "./server/api/breaking.ts"
    ]!()) as typeof import("./server/api/breaking");
    const { buildOpenApi } = await import("./server/api/openapi");
    const base = buildOpenApi();
    const head = structuredClone(base);
    const dig = (o: unknown, ...keys: string[]) => keys.reduce<unknown>((x, k) => (x as Record<string, unknown>)[k], o);
    const room = dig(
      head,
      "paths",
      "/api/v1/rooms",
      "get",
      "responses",
      "200",
      "content",
      "application/json",
      "schema",
      "properties",
      "rooms",
      "items",
    ) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    delete room.properties.title;
    room.required = room.required.filter((n: string) => n !== "title");

    const changes = breakingChanges(base, head);
    expect(changes.map((c) => c.message)).toEqual(["GET /api/v1/rooms 200 response.rooms[].title: property removed"]);
    const refused = verdict(changes, [{ id: "009", contractImpact: "api-minor" }]);
    expect(refused.ok).toBe(false);
    expect(refused.lines[1]).toBe(
      "  x [response-property-removed] GET /api/v1/rooms 200 response.rooms[].title: property removed",
    );

    const declared = verdict(changes, [{ id: "009", contractImpact: "api-major" }]);
    expect(declared.ok).toBe(true);
    expect(declared.lines[0]).toContain("PASS with notice");
  });
});
