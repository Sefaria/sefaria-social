// Spec 060 AC-006: a post whose text ends with a question mark is a question.
import { describe, expect, it } from "vitest";
import { isQuestion } from "./question";

describe("isQuestion (spec 060)", () => {
  // @feature FEED-077 Social wears the Sefaria Labs brand — a visual preview
  // @ac 060/AC-006
  it("is true for text ending with a question mark, after closing quotes and spaces, and false otherwise", () => {
    const cases = [
      "why does it say vayishlach yaakov?",
      "Who wrote this?  ",
      'He asked, "where are you?"',
      "למה כתוב וישלח?",
      "Today's daf: Berakhot 2a.",
      "Is this a question? No.",
      "",
    ];
    expect(cases.map(isQuestion)).toEqual([true, true, true, true, false, false, false]);
  });
});
