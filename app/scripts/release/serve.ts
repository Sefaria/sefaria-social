// A static server for a filesystem release target (local rehearsals and e2e/release.spec.ts): it serves each object with the
// content type and cache header the release stored, and CORS for every origin, like the asset origin must (the reader loads
// module scripts cross-origin with SRI, which needs CORS). Read-only; the metadata folder is never served.
import { createServer, type Server } from "node:http";
import { FileTarget, META_DIR, checkKey } from "./storage";

export function createReleaseServer(dir: string): Server {
  const target = new FileTarget(dir);
  return createServer(async (req, res) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": "accept",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors).end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { ...cors, allow: "GET, HEAD, OPTIONS" }).end();
      return;
    }
    let key: string;
    try {
      key = checkKey(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname.slice(1)));
    } catch {
      res.writeHead(404, cors).end("not found");
      return;
    }
    const obj = key.startsWith(`${META_DIR}/`) ? null : await target.get(key);
    if (!obj) {
      res.writeHead(404, { ...cors, "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(200, {
      ...cors,
      "content-type": obj.contentType,
      "cache-control": obj.cacheControl,
      "content-length": String(obj.body.length),
      "x-content-type-options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : obj.body);
  });
}
