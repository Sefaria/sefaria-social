// The logger's guarantees: JSON lines, static messages, scalar fields, redaction of anything named like a secret.
import { afterEach, describe, expect, it } from "vitest";
import { log, setLogLevel, setLogSink } from "./logger";

const capture = () => {
  const lines: string[] = [];
  setLogSink((l) => lines.push(l));
  return lines;
};

afterEach(() => {
  setLogSink(null);
  setLogLevel("info");
});

describe("logger", () => {
  it("writes one JSON line with the static message and the fields", () => {
    const lines = capture();
    log.info("request.completed", { method: "GET", status: 200 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: "info", msg: "request.completed", method: "GET", status: 200 });
  });

  it.each(["authorization", "token", "id_token", "body", "request_headers", "x-sefaria-signature", "secret", "cookie"])(
    "redacts a field named %s",
    (key) => {
      const lines = capture();
      log.warn("request.failed", { [key]: "Bearer eyJ.secret.value" });
      expect(JSON.parse(lines[0]!)[key]).toBe("[redacted]");
      expect(lines[0]).not.toContain("eyJ.secret.value");
    },
  );

  it("truncates long strings", () => {
    const lines = capture();
    log.info("request.completed", { route: "x".repeat(500) });
    expect(JSON.parse(lines[0]!).route).toHaveLength(201);
  });

  it("drops lines below the level", () => {
    const lines = capture();
    setLogLevel("warn");
    log.info("request.completed");
    log.error("request.failed");
    expect(lines.map((l) => JSON.parse(l).msg)).toEqual(["request.failed"]);
  });

  it("only accepts listed messages (checked by the compiler)", () => {
    const lines = capture();
    // @ts-expect-error a free-form message is a type error: messages are static
    log.info(`user ${42} did something`);
    expect(lines).toHaveLength(1);
  });
});
