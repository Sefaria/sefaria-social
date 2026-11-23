// The health check fails within its time limit when the database never answers, and only queries the database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setLogSink } from "../log/logger";
import { checkHealth } from "./health";

beforeAll(() => setLogSink(() => {}));
afterAll(() => setLogSink(null));

describe("checkHealth", () => {
  it("answers ok when the database answers", async () => {
    const calls: string[] = [];
    const result = await checkHealth({ query: (async (q: string) => (calls.push(q), { rows: [] })) as never });
    expect(result).toEqual({ status: 200, body: { status: "ok", database: "ok" } });
    expect(calls).toEqual(["select 1"]);
  });

  it("answers 503 within the limit when the database hangs", async () => {
    const started = Date.now();
    const result = await checkHealth({ query: (() => new Promise(() => {})) as never }, 50);
    expect(result).toEqual({ status: 503, body: { status: "unavailable", database: "unavailable" } });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
