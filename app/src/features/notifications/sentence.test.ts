// Notifications as sentences (spec 026 AC-004), in both interface languages.
// @feature FEED-067 The notifications list, unread count and the activity page
import { describe, expect, it } from "vitest";
import { stringsFor } from "~/features/shell/strings";
import { sentence } from "./ActivityPage";

const base = { id: "x", post: null, room: null, createdAt: "2026-11-24T00:00:00Z", read: false };
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

  // @feature ROOM-055 The invite bar in a room, and invitations in activity
  // @ac 058/AC-002
  it("says who invited you to which room", () => {
    const room = { id: "r", title: "Daf Yomi" };
    expect(sentence({ ...base, kind: "room_invite", actor, room }, stringsFor("english"))).toBe("Dina invited you to Daf Yomi");
    expect(sentence({ ...base, kind: "room_invite", actor, room }, stringsFor("hebrew"))).toBe("Dina הזמין/ה אותך אל Daf Yomi");
    expect(sentence({ ...base, kind: "room_invite", actor: null, room: null }, stringsFor("english"))).toBe(
      "Someone invited you to a room",
    );
  });
});
