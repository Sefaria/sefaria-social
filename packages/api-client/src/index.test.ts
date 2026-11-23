// The generated client sends the Bearer token from its callback and the correlation id, to the typed paths.
import { describe, expect, it } from "vitest";
import { createApiClient } from "./index";

describe("createApiClient", () => {
  it("sends the token and the correlation id", async () => {
    const seen: Request[] = [];
    const client = createApiClient({
      baseUrl: "https://social.test",
      getToken: async () => "header.payload.signature",
      correlationId: () => "surface-12345678",
      fetch: async (input) => {
        seen.push(input as Request);
        return new Response(JSON.stringify({ rooms: [] }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const { data, response } = await client.GET("/api/v1/rooms");
    expect(response.status).toBe(200);
    expect(data).toEqual({ rooms: [] });
    expect(seen[0]!.url).toBe("https://social.test/api/v1/rooms");
    expect(seen[0]!.headers.get("authorization")).toBe("Bearer header.payload.signature");
    expect(seen[0]!.headers.get("x-correlation-id")).toBe("surface-12345678");
  });

  it("sends no Authorization header when signed out", async () => {
    let auth: string | null = "unset";
    const client = createApiClient({
      baseUrl: "https://social.test",
      getToken: async () => null,
      fetch: async (input) => {
        auth = (input as Request).headers.get("authorization");
        return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
      },
    });
    const { response } = await client.GET("/api/v1/rooms/{roomId}", {
      params: { path: { roomId: "00000000-0000-4000-8000-000000000000" } },
    });
    expect(response.status).toBe(401);
    expect(auth).toBeNull();
  });
});
