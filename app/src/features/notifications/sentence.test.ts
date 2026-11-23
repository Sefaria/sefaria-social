// Notifications as sentences (spec 026 AC-004), in both interface languages.
// @feature FEED-067 The notifications list, unread count and marking read
import { describe, expect, it } from "vitest";
import { stringsFor } from "~/features/shell/strings";
import { sentence } from "./ActivityPage";

const base = { id: "x", post: null, createdAt: "2026-11-24T00:00:00Z", read: false };
const actor = { id: "a", name: "Dina" };

describe("activity sentences", () => {
  it("names who did what, and says someone when the actor is gone", () => {
    const en = stringsFor("english");
    expect(sentence({ ...base, kind: "follow", actor }, en)).toBe("Dina followed you");
    expect(sentence({ ...base, kind: "reply", actor }, en)).toBe("Dina replied to your post");
    expect(sentence({ ...base, kind: "reaction", actor }, en)).toBe("Dina said Yasher koach to your post");
    expect(sentence({ ...base, kind: "post", actor }, en)).toBe("Dina posted");
    expect(sentence({ ...base, kind: "post", actor: null }, en)).toBe("Someone posted");
    expect(sentence({ ...base, kind: "reply", actor }, stringsFor("hebrew"))).toBe("Dina הגיב/ה לפוסט שלך");
  });
});
