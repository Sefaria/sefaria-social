// Import a Claude asset from a URL (spec 060 AC-007; plan 6.4, D11, P4). The server fetches the file once, as an untrusted
// URL: https only; Claude's own links refused with the two routes that work; the host resolved once and refused when any
// answer is a private, loopback, link-local, unique-local, carrier-grade NAT, metadata or other special address; the
// connection made to that same address (so a second DNS answer cannot swap in an internal one), with the certificate checked
// against the host name; no redirects; `text/html` only; the size limit counted while the body streams; 10 seconds in all.
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import type { AssetProblem } from "../../lib/asset-manifest";

export const IMPORT_TIMEOUT_MS = 10_000;

const CLAUDE_HOSTS = ["claude.ai", "claudeusercontent.com"];

const CLAUDE_MESSAGE =
  'Claude links cannot be imported: the page Claude serves is an app shell without the file. Use the Sefaria connector in Claude ("save this to Sefaria"), or download the artifact as an HTML file and upload it to Sefaria.';

const problem = (code: string, message: string): { ok: false; problem: AssetProblem } => ({
  ok: false,
  problem: { code, message },
});

// ── Addresses ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const refused = new net.BlockList();
for (const [net4, bits] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT (and Alibaba's metadata, 100.100.100.200)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata (169.254.169.254)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const)
  refused.addSubnet(net4, bits, "ipv4");
for (const [net6, bits] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local (AWS metadata fd00:ec2::254 included)
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const)
  refused.addSubnet(net6, bits, "ipv6");

/** The IPv4 address an IPv6 address carries (IPv4-mapped, IPv4-compatible, NAT64, 6to4), or null. */
function embeddedV4(ip6: string): string | null {
  const lower = ip6.toLowerCase();
  const dotted = /^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return dotted[1]!;
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  const sixToFour = /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/.exec(lower);
  const m = hex ?? sixToFour;
  if (!m) return null;
  const hi = parseInt(m[1]!, 16);
  const lo = parseInt(m[2]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** Whether the server must refuse to connect to this address. Anything that is not an IP address is refused. */
export function refusedAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return refused.check(ip, "ipv4");
  if (kind === 6) {
    const v4 = embeddedV4(ip);
    if (v4 !== null) return refusedAddress(v4);
    return refused.check(ip, "ipv6");
  }
  return true;
}

// ── The URL ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const isClaudeHost = (host: string) => CLAUDE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

/** The URL's own checks, before anything is resolved or fetched. */
export function checkImportUrl(raw: string): { ok: true; url: URL } | { ok: false; problem: AssetProblem } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return problem("import.invalid_url", "That is not a URL. Give the full https:// address of a raw HTML file.");
  }
  if (isClaudeHost(url.hostname.toLowerCase().replace(/\.$/, ""))) return problem("import.claude_link", CLAUDE_MESSAGE);
  if (url.protocol !== "https:")
    return problem("import.https_only", "Only https:// URLs can be imported. Give the https address of the HTML file.");
  if (url.username || url.password)
    return problem("import.invalid_url", "A URL with a user name or password cannot be imported.");
  return { ok: true, url };
}

// ── Fetching ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Resolved = { address: string; family: 4 | 6 }[];
export type ImportResult = { ok: true; html: string } | { ok: false; problem: AssetProblem };
export type ImportFetcher = (url: URL, maxBytes: number) => Promise<ImportResult>;

export interface FetchOptions {
  resolve?: (host: string) => Promise<Resolved>;
  refuse?: (ip: string) => boolean;
  /** Extra trusted certificate authorities (tests). */
  ca?: string | Buffer;
  timeoutMs?: number;
}

const systemResolve = async (host: string): Promise<Resolved> =>
  (await dns.lookup(host, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));

/** The real fetcher: resolve once, check every answer, connect to the checked address, no redirects, capped while reading. */
export async function fetchPinned(url: URL, maxBytes: number, opts: FetchOptions = {}): Promise<ImportResult> {
  const { resolve = systemResolve, refuse = refusedAddress, ca, timeoutMs = IMPORT_TIMEOUT_MS } = opts;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: Resolved;
  try {
    const literal = net.isIP(host);
    addresses = literal ? [{ address: host, family: literal === 6 ? 6 : 4 }] : await resolve(host);
  } catch {
    return problem("import.fetch_failed", `The host "${host}" could not be found. Check the URL.`);
  }
  if (addresses.length === 0) return problem("import.fetch_failed", `The host "${host}" could not be found. Check the URL.`);
  if (addresses.some((a) => refuse(a.address)))
    return problem(
      "import.address_refused",
      "That URL points to a private or reserved network address, which cannot be imported.",
    );
  const pinned = addresses[0]!;

  return new Promise<ImportResult>((done) => {
    let settled = false;
    const finish = (r: ImportResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      done(r);
    };
    const req = https.request(
      {
        protocol: "https:",
        hostname: host,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { accept: "text/html", "user-agent": "SefariaSocial-AssetImport/1" },
        servername: net.isIP(host) ? undefined : host,
        agent: false,
        ca,
        // Connect to the address that was checked, whatever DNS says now.
        lookup: ((_h: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => {
          if (options?.all) cb(null, [{ address: pinned.address, family: pinned.family }]);
          else cb(null, pinned.address, pinned.family);
        }) as unknown as net.LookupFunction,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400)
          return finish(problem("import.redirect", "The URL answers with a redirect. Give the final address of the HTML file."));
        if (status !== 200)
          return finish(problem("import.fetch_failed", `The URL answered with status ${status}. Check that it is public.`));
        const type = String(res.headers["content-type"] ?? "").toLowerCase();
        if (!/^text\/html\b/.test(type))
          return finish(
            problem(
              "import.not_html",
              "The URL does not answer an HTML page (text/html). Give the address of the raw HTML file.",
            ),
          );
        const tooLarge = () =>
          problem(
            "size.too_large",
            `The file is larger than the limit of ${(maxBytes / 1_048_576).toFixed(1)} MB. Make it smaller.`,
          );
        if (Number(res.headers["content-length"] ?? 0) > maxBytes) return finish(tooLarge());
        const parts: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > maxBytes) return finish(tooLarge());
          parts.push(chunk);
        });
        res.on("end", () => finish({ ok: true, html: Buffer.concat(parts).toString("utf8") }));
        res.on("error", () => finish(problem("import.fetch_failed", "The download was interrupted. Try again.")));
      },
    );
    const timer = setTimeout(
      () => finish(problem("import.fetch_failed", "The URL did not answer within 10 seconds.")),
      timeoutMs,
    );
    req.on("error", () =>
      finish(
        problem("import.fetch_failed", "The URL could not be fetched. Check that it is public and uses a valid certificate."),
      ),
    );
    req.end();
  });
}

let fetcher: ImportFetcher = (url, maxBytes) => fetchPinned(url, maxBytes);

/** The fetcher the import route uses. Tests answer a page without the network; `null` restores the real one. */
export function setImportFetcher(f: ImportFetcher | null): void {
  fetcher = f ?? ((url, maxBytes) => fetchPinned(url, maxBytes));
}

/** Check the URL, then fetch it with the current fetcher. */
export async function fetchForImport(
  raw: string,
  maxBytes: number,
): Promise<{ ok: true; html: string; url: URL } | { ok: false; problem: AssetProblem }> {
  const checked = checkImportUrl(raw);
  if (!checked.ok) return checked;
  const got = await fetcher(checked.url, maxBytes);
  return got.ok ? { ...got, url: checked.url } : got;
}
