// The signature check against Django's published test vector, and its refusals.
import { describe, expect, it } from "vitest";
import { sign, verifySignature } from "./signature";

const VECTOR_BODY = '{"event":"user.deleted","id":"x","occurred_at":"2026-11-23T01:02:03Z","user_id":42}';
const VECTOR_SIG = "sha256=5a26b7ac2ff4e75aeec9a4dfa56aab52601ce60bb5435b0b44ac82515678a165";

describe("webhook signature", () => {
  it("matches Django's test vector", () => {
    expect(sign("secret", VECTOR_BODY)).toBe(VECTOR_SIG);
    expect(verifySignature("secret", VECTOR_BODY, VECTOR_SIG)).toBe(true);
  });

  it.each([
    ["no header", null],
    ["no prefix", VECTOR_SIG.slice(7)],
    ["upper-case hex", VECTOR_SIG.toUpperCase()],
    ["truncated", VECTOR_SIG.slice(0, -2)],
    ["another secret", sign("other", VECTOR_BODY)],
  ])("refuses %s", (_case, header) => {
    expect(verifySignature("secret", VECTOR_BODY, header)).toBe(false);
  });

  it("refuses a valid signature over a different body", () => {
    expect(verifySignature("secret", VECTOR_BODY.replace("42", "43"), VECTOR_SIG)).toBe(false);
  });
});
