// Spec 061: the shiur grant and the policies, without a database.
// @feature SHIUR-010 Claude asset content served sandboxed from its own origin
import { afterEach, describe, expect, it } from "vitest";
import { resetConfig } from "../config";
import { checkGrant, GRANT_LIFETIME_S, publicPolicy, shiurContentUrl, shiurGrant } from "./asset-content";

const SHIUR = "11111111-2222-4333-8444-555555555555";
const VERSION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";

afterEach(() => {
  for (const k of ["ASSET_CONTENT_SECRET", "ASSET_CONTENT_ORIGIN", "SOCIAL_ALLOWED_ORIGINS"]) delete process.env[k];
  resetConfig();
});

describe("asset content", () => {
  it("signs a grant for one shiur and version that expires, and refuses any change to it", () => {
    process.env.ASSET_CONTENT_SECRET = "unit-test-secret-0123456789";
    resetConfig();
    const now = 1_800_000_000;
    const grant = shiurGrant(SHIUR, VERSION, now)!;
    const [sid, exp, mac] = grant.split(".");
    expect([sid, Number(exp) - now]).toEqual([SHIUR, GRANT_LIFETIME_S]);
    expect([
      checkGrant(grant, VERSION, now + 10),
      checkGrant(grant, OTHER, now + 10),
      checkGrant(grant, VERSION, now + GRANT_LIFETIME_S),
      checkGrant(`${sid}.${Number(exp) + 1}.${mac}`, VERSION, now),
      checkGrant(`${sid}.${exp}.${mac!.replace(/^./, (c) => (c === "A" ? "B" : "A"))}`, VERSION, now),
      checkGrant("garbage", VERSION, now),
    ]).toEqual([SHIUR, null, null, null, null, null]);
  });

  it("issues no shiur URL and accepts no grant without a secret", () => {
    expect([
      shiurGrant(SHIUR, VERSION),
      shiurContentUrl(SHIUR, VERSION),
      checkGrant(`${SHIUR}.9999999999.${"A".repeat(43)}`, VERSION),
    ]).toEqual([null, null, null]);
  });

  it("frames nowhere when no reader origin is configured", () => {
    expect(publicPolicy()).toContain("frame-ancestors 'none'");
    process.env.SOCIAL_ALLOWED_ORIGINS = "https://www.sefaria.org";
    resetConfig();
    expect(publicPolicy()).toContain("frame-ancestors https://www.sefaria.org;");
  });
});
