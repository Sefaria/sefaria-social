// Serves the harness (harness/dist) and the built surface (app/dist-surface, under /surface/) on one port, like a reader page
// and a social release. Every path that is not a file (outside /assets/ and /surface/) gets the harness page, so deep links (/social/r/<id>) load directly.
// Usage: npm run harness   (HARNESS_PORT, default 3300). Build first: npm run build:surface && npm run build:harness.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_DIR = path.join(here, "dist");
const SURFACE_DIR = path.resolve(here, "../app/dist-surface");
const TEXTS_DIR = path.join(here, "fixtures", "texts");
const TEXTS_PATH = "/api/v3/texts/";
const PORT = Number(process.env.HARNESS_PORT) || 3300;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

async function file(dir, rel) {
  const full = path.resolve(dir, `.${rel}`);
  if (!full.startsWith(dir + path.sep)) return null; // no path traversal
  try {
    return (await stat(full)).isFile() ? full : null;
  } catch {
    return null; // not a file: the caller falls back to the harness page
  }
}

/**
 * Sefaria's public text API, played from recorded answers (harness/fixtures/record-texts.mjs; public data), so cards render
 * real text without the network. Same file-name rule as the recorder. An unrecorded ref is 404, like an unknown ref.
 */
async function serveText(url, res) {
  let ref;
  try {
    ref = decodeURIComponent(url.pathname.slice(TEXTS_PATH.length));
  } catch {
    ref = "";
  }
  const found = ref && (await file(TEXTS_DIR, `/${ref.replace(/[^A-Za-z0-9.-]+/g, "_")}.json`));
  if (!found) {
    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: `no recorded text for ${ref}` }));
    return;
  }
  res.writeHead(200, { "content-type": TYPES[".json"], "cache-control": "no-cache" }).end(await readFile(found));
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname.startsWith(TEXTS_PATH)) {
    await serveText(url, res);
    return;
  }
  const isSurface = url.pathname.startsWith("/surface/");
  const found = isSurface
    ? await file(SURFACE_DIR, url.pathname.slice("/surface".length))
    : await file(HARNESS_DIR, url.pathname);
  const target = found ?? (isSurface || url.pathname.startsWith("/assets/") ? null : path.join(HARNESS_DIR, "index.html"));
  if (!target) {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    return;
  }
  const headers = { "content-type": TYPES[path.extname(target)] ?? "application/octet-stream", "cache-control": "no-cache" };
  // The reader loads the surface cross-origin with SRI, which needs CORS; the harness serves it the same way.
  if (isSurface) headers["access-control-allow-origin"] = "*";
  res.writeHead(200, headers).end(await readFile(target));
}).listen(PORT, () => console.log(`harness on http://localhost:${PORT}/social`));
