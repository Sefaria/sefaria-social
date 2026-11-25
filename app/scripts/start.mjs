// The production entry of the social server (spec 021; the container's CMD): serves the built Start app over Node's http
// module with no extra dependency. Requests under /assets/ are the standalone pages' client files from dist/client (hashed
// names, cached for a year); everything else goes to the built server's fetch handler (dist/server/server.js): the API,
// webhooks, health and the standalone pages. Stops on SIGTERM: no new connections, in-flight requests get up to 8 seconds.
//
//   node app/scripts/start.mjs        PORT (default 3200), HOST (default 0.0.0.0); the server's own variables: docs/runbooks/server.md
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP = fileURLToPath(new URL("..", import.meta.url));
const CLIENT = path.join(APP, "dist", "client");
const PORT = Number(process.env.PORT) || 3200;
const HOST = process.env.HOST || "0.0.0.0";
/** Request bodies above this are refused: the largest the API takes is a recording's media chunk (4 MiB, spec 041); each
 *  endpoint applies its own, smaller limit. At 1 MiB this refused every chunk over 1 MB, and the recording failed. */
const MAX_BODY = 4 * 1024 * 1024;
const TYPES = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };

const app = (await import(pathToFileURL(path.join(APP, "dist", "server", "server.js")).href)).default;

async function clientFile(pathname) {
  const full = path.resolve(CLIENT, `.${decodeURIComponent(pathname)}`);
  if (!full.startsWith(CLIENT + path.sep)) return null;
  try {
    return (await stat(full)).isFile() ? full : null;
  } catch {
    return null;
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) return null;
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (req, res) => {
  try {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if ((method === "GET" || method === "HEAD") && url.pathname.startsWith("/assets/")) {
      const file = await clientFile(url.pathname);
      if (file) {
        const body = await readFile(file);
        res.writeHead(200, {
          "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
          "cache-control": "public, max-age=31536000, immutable",
          "content-length": String(body.length),
        });
        res.end(method === "HEAD" ? undefined : body);
        return;
      }
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) for (const x of v) headers.append(k, x);
      else if (typeof v === "string") headers.set(k, v);
    }
    let body;
    if (method !== "GET" && method !== "HEAD") {
      body = await readBody(req);
      if (body === null) {
        res
          .writeHead(413, { "content-type": "application/json" })
          .end('{"error":{"code":"request.too_large","message":"Request body too large"}}');
        return;
      }
    }
    const response = await app.fetch(new Request(url, { method, headers, body }));
    const out = {};
    response.headers.forEach((v, k) => {
      if (k !== "set-cookie") out[k] = v;
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) out["set-cookie"] = cookies;
    res.writeHead(response.status, out);
    if (!response.body || method === "HEAD") res.end();
    else Readable.fromWeb(response.body).pipe(res);
  } catch (e) {
    console.error(JSON.stringify({ level: "error", event: "server.unhandled", message: String(e?.message ?? e) }));
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end('{"error":{"code":"internal","message":"Internal error"}}');
  }
});

server.listen(PORT, HOST, () => console.log(JSON.stringify({ level: "info", event: "server.listening", port: PORT })));

let stopping = false;
const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ level: "info", event: "server.stopping", signal }));
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, 8_000).unref();
};
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
