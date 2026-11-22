// The ctx codec (plan 4.4; routing rules R3 and R11). Loaded through import.meta.glob so each test fails on an assertion where
// the module does not exist (prove-red).
import { describe, expect, it } from "vitest";

const modules = import.meta.glob<typeof import("./ctx")>("./ctx.ts");
async function load() {
  const mod = await modules["./ctx.ts"]?.();
  expect(mod, "app/src/lib/ctx.ts exists").toBeDefined();
  return mod!;
}

describe("ctx codec", () => {
  // @feature SESS-001 Social context in the reader's ctx parameter
  // @ac 003/AC-001
  it("encodes rooms and shiurim as social.room.<id> and social.shiur.<id>, and decodes them back", async () => {
    const { encodeCtx, decodeCtx } = await load();
    expect(encodeCtx({ kind: "room", id: "room-00001" })).toBe("social.room.room-00001");
    expect(encodeCtx({ kind: "shiur", id: "Shiur_Abc-123" })).toBe("social.shiur.Shiur_Abc-123");
    expect(decodeCtx("social.room.room-00001")).toEqual({ kind: "room", id: "room-00001" });
    expect(decodeCtx("social.shiur.Shiur_Abc-123")).toEqual({ kind: "shiur", id: "Shiur_Abc-123" });
    const longest = "a".repeat(128);
    expect(decodeCtx(encodeCtx({ kind: "room", id: longest }))).toEqual({ kind: "room", id: longest });
    expect(() => encodeCtx({ kind: "room", id: "short" })).toThrow();
  });

  // @feature SESS-001 Social context in the reader's ctx parameter
  // @ac 003/AC-002
  it("treats anything that is not a well-formed social value as no context (untrusted input)", async () => {
    const { decodeCtx } = await load();
    const values: unknown[] = [
      "other.room.room-00001",
      "social.room.short",
      "social.room.room-00001.extra",
      "social.chat.room-00001",
      "social.room.room 00001",
      "Social.room.room-00001",
      "social.room." + "a".repeat(129),
      "",
      null,
      42,
      { kind: "room", id: "room-00001" },
    ];
    expect(values.map((v) => decodeCtx(v))).toEqual(values.map(() => null));
  });

  // @feature SESS-001 Social context in the reader's ctx parameter
  // @ac 003/AC-003
  it("writes and removes only its own ctx and keeps every other parameter, the path and the hash byte for byte (R3)", async () => {
    const { withCtx, withoutCtx, readCtx } = await load();
    const url = "/Genesis.1.3?lang=bi&with=Commentary+ConnectionsList&ven=German_[de]#seg";
    const entered = withCtx(url, { kind: "room", id: "room-00001" });
    expect(entered).toBe("/Genesis.1.3?lang=bi&with=Commentary+ConnectionsList&ven=German_[de]&ctx=social.room.room-00001#seg");
    expect(readCtx(entered)).toEqual({ kind: "room", id: "room-00001" });
    expect(withoutCtx(entered)).toBe(url);
    const replaced = withCtx("/Genesis.1?ctx=social.room.room-00001&a=%2B", { kind: "shiur", id: "shiur-0001" });
    expect(replaced).toBe("/Genesis.1?a=%2B&ctx=social.shiur.shiur-0001");
    expect(withoutCtx("/Genesis.1?ctx=other.thing&a=1")).toBe("/Genesis.1?ctx=other.thing&a=1");
    expect(readCtx("/Genesis.1?ctx=other.thing")).toBeNull();
    expect(readCtx("?ctx=social.shiur.shiur-0001")).toEqual({ kind: "shiur", id: "shiur-0001" });
  });

  // @feature SESS-001 Social context in the reader's ctx parameter
  // @ac 003/AC-001
  it("fits the reader's grammar for any ctx value (namespace, dot, at most 160 characters)", async () => {
    const { encodeCtx, CTX_VALUE_RE } = await load();
    const value = encodeCtx({ kind: "shiur", id: "z".repeat(128) });
    expect(CTX_VALUE_RE.test(value)).toBe(true);
    expect(value.length - "social.".length).toBeLessThanOrEqual(160);
  });
});
