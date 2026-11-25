// Spec 055: which links in the composer's text become a card.
// @feature FEED-075 Links in post text, and a session card in the composer and in posts
import { describe, expect, it } from "vitest";
import { embedPath, findEmbedLink, originOf } from "./embed-link";

const ID = "0b6f8f7e-3f43-4a36-9b8e-7e1f6c2a9d10";

describe("findEmbedLink", () => {
  it("finds room, broadcast and recording links as paths and on Sefaria origins", () => {
    expect(findEmbedLink(`/social/r/${ID}`)).toEqual({ kind: "room", id: ID, start: 0, end: 46, text: `/social/r/${ID}` });
    expect(findEmbedLink(`look https://www.sefaria.org/social/b/${ID}.`)?.kind).toBe("broadcast");
    expect(findEmbedLink(`https://www.sefaria.org.il/social/rec/${ID}?t=3`)?.text).toBe(
      `https://www.sefaria.org.il/social/rec/${ID}?t=3`,
    );
    expect(findEmbedLink(`https://social-7.cauldron.sefaria.org/social/r/${ID}`)?.kind).toBe("room");
    expect(findEmbedLink(`http://localhost:3100/social/r/${ID}`, "http://localhost:3100")?.kind).toBe("room");
  });

  it("ignores other origins, other paths and links glued to other text", () => {
    expect(findEmbedLink(`https://evil.example/social/r/${ID}`)).toBeNull();
    expect(findEmbedLink(`https://sefaria.org.evil.example/social/r/${ID}`)).toBeNull();
    expect(findEmbedLink(`http://localhost:3100/social/r/${ID}`)).toBeNull();
    expect(findEmbedLink(`/social/u/${ID}`)).toBeNull();
    expect(findEmbedLink(`/social/r/not-an-id`)).toBeNull();
    expect(findEmbedLink(`x/social/r/${ID}`)).toBeNull();
    expect(findEmbedLink(`/social/r/${ID}abc`)).toBeNull();
  });

  it("takes the first link of several", () => {
    expect(findEmbedLink(`/social/b/${ID} and /social/r/${ID}`)?.kind).toBe("broadcast");
  });
});

describe("helpers", () => {
  it("builds the page a card opens and reads an origin from an absolute href", () => {
    expect([embedPath("room", ID), embedPath("broadcast", ID), embedPath("recording", ID)]).toEqual([
      `/social/r/${ID}`,
      `/social/b/${ID}`,
      `/social/rec/${ID}`,
    ]);
    expect([originOf("https://www.sefaria.org/social"), originOf("/social"), originOf(undefined)]).toEqual([
      "https://www.sefaria.org",
      null,
      null,
    ]);
  });
});
