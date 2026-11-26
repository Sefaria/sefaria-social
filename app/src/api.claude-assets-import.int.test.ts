// Acceptance tests for spec 060 AC-007 (import a Claude asset from a URL), L2: real Postgres through the route tree. The page
// is answered by a test fetcher (no network); the real fetcher's address pinning, redirects and size cap are proven against
// a local HTTPS server in server/services/asset-import.test.ts.
// @feature SHIUR-009 Import a Claude asset from a public HTTPS URL
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRouter } from "~/router";
import { assetHtml, startFakeSefaria, type FakeSefaria } from "../../test/integration/fake-sefaria";

const IMPORT = "/api/v1/claude-assets/import";

function served(method: string, p: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(p);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== p) return undefined;
  return r.options?.server?.handlers?.[method];
}

type Refused = { error: { code: string }; problems: { code: string; message: string }[] };
let sefaria: FakeSefaria;
beforeAll(async () => {
  sefaria = await startFakeSefaria();
});
afterAll(async () => {
  await sefaria.close();
  const { setImportFetcher } = await import("~/server/services/asset-import");
  setImportFetcher(null);
});

describe("spec 060: import from a URL", () => {
  // @ac 060/AC-007
  it("imports a public https page and keeps its URL as the source; refuses Claude links, http, private addresses and bad answers", async () => {
    expect(served("POST", IMPORT), `POST ${IMPORT} is served`).toBeTypeOf("function");
    process.env.ASSET_STORE_DIR = mkdtempSync(path.join(tmpdir(), "social-import-"));
    process.env.SEFARIA_API_ORIGIN = sefaria.origin;
    const h = await (await import("../../test/integration/harness")).harness(getRouter());
    const { setImportFetcher, refusedAddress } = await import("~/server/services/asset-import");
    const fetched: string[] = [];
    const pages: Record<string, { ok: true; html: string } | { ok: false; problem: { code: string; message: string } }> = {
      "https://assets.example.org/days.html": { ok: true, html: assetHtml(["Genesis 1:1-5"]) },
      "https://assets.example.org/moved": { ok: false, problem: { code: "import.redirect", message: "redirect" } },
      "https://assets.example.org/data.json": { ok: false, problem: { code: "import.not_html", message: "not html" } },
      "https://assets.example.org/huge.html": { ok: false, problem: { code: "size.too_large", message: "too large" } },
    };
    // A fetcher with the real rule for addresses: "internal.example.org" resolves to a private address.
    setImportFetcher(async (url) => {
      fetched.push(url.href);
      if (url.hostname === "internal.example.org" && refusedAddress("10.0.0.7"))
        return { ok: false, problem: { code: "import.address_refused", message: "private" } };
      return pages[url.href] ?? { ok: false, problem: { code: "import.fetch_failed", message: "404" } };
    });
    const token = await h.token(961001, { name: "Importer" });
    const post = (url: string) => h.call("POST", IMPORT, { token, body: { url } });

    const ok = await post("https://assets.example.org/days.html");
    const saved = ok.json as { asset: { id: string; sourceUrl: string; title: string }; version: { n: number } };
    expect([ok.status, saved.asset.sourceUrl, saved.asset.title, saved.version.n]).toEqual([
      201,
      "https://assets.example.org/days.html",
      "The Seven Days",
      1,
    ]);

    const before = fetched.length;
    const early = [];
    for (const url of [
      "http://example.org/a.html",
      "https://claude.ai/public/artifacts/x",
      "https://x.claudeusercontent.com/a",
    ]) {
      const r = await post(url);
      early.push(`${r.status} ${(r.json as Refused).problems[0]!.code}`);
    }
    expect(early).toEqual(["422 import.https_only", "422 import.claude_link", "422 import.claude_link"]);
    expect(fetched.length, "nothing fetched for a refused URL").toBe(before);
    const claude = (await post("https://claude.ai/public/artifacts/x")).json as Refused;
    expect(claude.problems[0]!.message).toMatch(/"save this to Sefaria".*upload/);

    const late = [];
    for (const url of [
      "https://internal.example.org/a.html",
      "https://assets.example.org/moved",
      "https://assets.example.org/data.json",
      "https://assets.example.org/huge.html",
    ]) {
      const r = await post(url);
      late.push(`${r.status} ${(r.json as Refused).problems[0]!.code}`);
    }
    expect(late).toEqual(["422 import.address_refused", "422 import.redirect", "422 import.not_html", "422 size.too_large"]);
    expect(await h.sql("select count(*)::int as n from assets")).toEqual([{ n: 1 }]);
  });
});
