// Relative times (spec 023 AC-006): short and in the interface language, a date past a week.
// @feature FEED-063 The composer and the timeline on /social
import { describe, expect, it } from "vitest";
import { stringsFor } from "~/features/shell/strings";
import { relative } from "./RelativeTime";

const NOW = Date.parse("2026-11-24T12:00:00Z");
const at = (ms: number) => new Date(NOW - ms).toISOString();

describe("relative time", () => {
  it("reads now, minutes, hours, days, then a short date, in English and Hebrew", () => {
    const en = stringsFor("english");
    const he = stringsFor("hebrew");
    expect(relative(at(20_000), NOW, en, "english")).toBe("now");
    expect(relative(at(5 * 60_000), NOW, en, "english")).toBe("5 min");
    expect(relative(at(2 * 3_600_000), NOW, en, "english")).toBe("2 h");
    expect(relative(at(3 * 86_400_000), NOW, en, "english")).toBe("3 d");
    expect(relative("2026-11-03T09:00:00Z", NOW, en, "english")).toBe("Nov 3");
    expect(relative("2025-02-01T09:00:00Z", NOW, en, "english")).toMatch(/2025/);
    expect(relative(at(20_000), NOW, he, "hebrew")).toBe("עכשיו");
    expect(relative(at(5 * 60_000), NOW, he, "hebrew")).toBe("5 דק׳");
  });
});
