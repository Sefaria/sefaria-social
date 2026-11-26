// Spec 060 AC-007: importing from a URL treats it as untrusted. The address rules are pure; the real fetcher runs against a
// local HTTPS server (a key and certificate made with openssl for this run) to prove it connects to the address it checked,
// refuses redirects and non-HTML, and stops reading at the size limit.
// @feature SHIUR-009 Import a Claude asset from a public HTTPS URL
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkImportUrl, fetchPinned, refusedAddress, type Resolved } from "./asset-import";

const dir = mkdtempSync(path.join(tmpdir(), "social-import-tls-"));
const key = path.join(dir, "key.pem");
const cert = path.join(dir, "cert.pem");
let server: Server;
let port = 0;
const seen: string[] = [];

beforeAll(async () => {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=assets.example.test",
      "-addext",
      "subjectAltName=DNS:assets.example.test",
    ],
    { stdio: "ignore" },
  );
  server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    seen.push(`${req.headers.host} ${req.url}`);
    if (req.url === "/asset.html")
      return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<html>ok</html>");
    if (req.url === "/moved") return void res.writeHead(302, { location: "https://assets.example.test/asset.html" }).end();
    if (req.url === "/json") return void res.writeHead(200, { "content-type": "application/json" }).end("{}");
    if (req.url === "/big") {
      res.writeHead(200, { "content-type": "text/html" }); // no content-length: the cap must hold while streaming
      for (let i = 0; i < 20; i++) res.write("x".repeat(1000));
      return void res.end();
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// The host resolves to the local server; only for these tests is that address allowed.
const local = async (): Promise<Resolved> => [{ address: "127.0.0.1", family: 4 }];
const opts = () => ({ resolve: local, refuse: (ip: string) => ip !== "127.0.0.1", ca: readFileSync(cert) });
const at = (p: string) => new URL(`https://assets.example.test:${port}${p}`);

describe("import from a URL", () => {
  it("refuses private, loopback, link-local, unique-local, NAT and metadata addresses, IPv4 and IPv6", () => {
    const refused = [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.5.4",
      "192.168.0.1",
      "169.254.169.254",
      "100.100.100.200",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "fd00::1",
      "fd00:ec2::254",
      "fe80::1",
      "::ffff:192.168.0.1",
      "::ffff:7f00:1",
      "64:ff9b::a00:1",
      "2002:a00:1::1",
      "not-an-ip",
    ];
    const allowed = ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:93.184.216.34"];
    expect(refused.filter((ip) => !refusedAddress(ip))).toEqual([]);
    expect(allowed.filter((ip) => refusedAddress(ip))).toEqual([]);
  });

  it("refuses Claude links with the two routes that work, and anything that is not https", () => {
    const codes = [
      "https://claude.ai/public/artifacts/abc",
      "https://x.claudeusercontent.com/a.html",
      "http://claude.ai/x",
      "http://example.org/a.html",
      "ftp://example.org/a.html",
      "https://user:pw@example.org/a.html",
      "not a url",
    ].map((u) => {
      const r = checkImportUrl(u);
      return r.ok ? "ok" : r.problem.code;
    });
    expect(codes).toEqual([
      "import.claude_link",
      "import.claude_link",
      "import.claude_link",
      "import.https_only",
      "import.https_only",
      "import.invalid_url",
      "import.invalid_url",
    ]);
    const claude = checkImportUrl("https://claude.ai/public/artifacts/abc");
    expect(claude.ok ? "" : claude.problem.message).toMatch(/Sefaria connector in Claude \("save this to Sefaria"\).*upload/);
  });

  it("connects to the address it checked, whatever the host name, and reads the page", async () => {
    const r = await fetchPinned(at("/asset.html"), 10_000, opts());
    expect(r).toEqual({ ok: true, html: "<html>ok</html>" });
    expect(seen.at(-1)).toBe(`assets.example.test:${port} /asset.html`);
  });

  it("refuses before connecting when any answer is a refused address", async () => {
    const before = seen.length;
    const r = await fetchPinned(at("/asset.html"), 10_000, {
      resolve: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.7", family: 4 },
      ],
      ca: readFileSync(cert),
    });
    expect([r.ok ? "ok" : r.problem.code, seen.length]).toEqual(["import.address_refused", before]);
  });

  it("refuses a redirect, a page that is not HTML, and a body past the limit while it streams", async () => {
    const codes = [];
    for (const [p, max] of [
      ["/moved", 10_000],
      ["/json", 10_000],
      ["/big", 5_000],
    ] as const) {
      const r = await fetchPinned(at(p), max, opts());
      codes.push(r.ok ? "ok" : r.problem.code);
    }
    expect(codes).toEqual(["import.redirect", "import.not_html", "size.too_large"]);
  });
});
