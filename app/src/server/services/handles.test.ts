import { describe, expect, it } from "vitest";
import { canonicalHandle, handleProblem } from "./handles";

// Spec 057: canonical form first, then the rules.
describe("handles", () => {
  it("puts what was typed in canonical form", () => {
    expect(canonicalHandle("  @Rachel_C ")).toBe("rachel_c");
    expect(canonicalHandle("ｒａｃｈｅｌ")).toBe("rachel");
    expect(canonicalHandle("@@x")).toBe("@x");
    expect(canonicalHandle("a".repeat(500))).toHaveLength(64);
  });

  it("allows 3–30 of a–z, 0–9 and _, starting with a letter, and not reserved", () => {
    expect(handleProblem("rachel_c")).toBeNull();
    expect(handleProblem("abc")).toBeNull();
    expect(handleProblem("a".repeat(30))).toBeNull();
    for (const bad of ["ab", "a".repeat(31), "1abc", "_abc", "a-b-c", "has space", "rächel", "", "@abc"])
      expect(handleProblem(bad), bad).toBe("invalid");
    expect(handleProblem("admin")).toBe("reserved");
    expect(handleProblem("sefaria")).toBe("reserved");
    for (const lookalike of ["sefaria_team", "sefaria1", "admin_", "staff_x", "official_rav"])
      expect(handleProblem(lookalike), lookalike).toBe("reserved");
    expect(handleProblem("rachel_admin")).toBeNull();
  });
});
