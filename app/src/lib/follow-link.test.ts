// Spec 032: follow-me links in and out of addresses, the same grammar as the reader's follow/params.ts and lib/ref/url.ts.
import { describe, expect, it } from "vitest";
import { findFollowLink, parseFollowLink, refFromReaderUrl, withFollowParam } from "./follow-link";

const ID = "0aZ".repeat(14) + "9";

describe("follow links", () => {
  it("reads the ref an address opened on, the way the reader writes refs into addresses", () => {
    expect(refFromReaderUrl("/Genesis.1.1-5?lang=bi")).toBe("Genesis 1:1-5");
    expect(refFromReaderUrl("/Mishnah_Berakhot.2")).toBe("Mishnah Berakhot 2");
    expect(refFromReaderUrl("/Berakhot.2a.3-2b.4")).toBe("Berakhot 2a:3-2b:4");
    expect(refFromReaderUrl("/Pesach_Haggadah,_Kadesh")).toBe("Pesach Haggadah, Kadesh");
    expect(refFromReaderUrl("https://www.sefaria.org/Rashi_on_Exodus.3.2.1")).toBe("Rashi on Exodus 3:2:1");
    expect(refFromReaderUrl("/Exodus%203%3A2")).toBe("Exodus 3:2");
    for (const notText of ["/", "/social/feed", "/sheets/12", "/topics/moses", "Exodus.3", "//evil.example/x", null, ""])
      expect(refFromReaderUrl(notText)).toBeNull();
  });

  it("finds a well-formed session id only, in an absolute address or a path, and ignores trailing punctuation", () => {
    expect(parseFollowLink(`https://www.sefaria.org/Exodus.3?lang=bi&follow=${ID}#x`)).toEqual({
      sessionId: ID,
      ref: "Exodus 3",
    });
    expect(parseFollowLink(`/?follow=${ID}`)).toEqual({ sessionId: ID, ref: null });
    expect(parseFollowLink("/Exodus.3?follow=short")).toBeNull();
    expect(parseFollowLink(`javascript:alert(1)?follow=${ID}`)).toBeNull();
    expect(findFollowLink(`Live (https://www.sefaria.org/Exodus.3.2?follow=${ID}).`)).toEqual({
      sessionId: ID,
      ref: "Exodus 3:2",
    });
    expect(findFollowLink(`see /Exodus.3.2?follow=${ID}, now`)?.sessionId).toBe(ID);
    expect(findFollowLink("nothing here https://www.sefaria.org/Exodus.3")).toBeNull();
  });

  it("puts follow=<id> on an address in place of any earlier one, the hash last", () => {
    expect(withFollowParam("/Exodus.3?lang=bi#seg", ID)).toBe(`/Exodus.3?lang=bi&follow=${ID}#seg`);
    expect(withFollowParam(`/Exodus.3?follow=old&lang=bi`, ID)).toBe(`/Exodus.3?lang=bi&follow=${ID}`);
    expect(withFollowParam("/", ID)).toBe(`/?follow=${ID}`);
  });
});
