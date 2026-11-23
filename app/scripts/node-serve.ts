// Serve a fetch handler (the built Start server's, or a wrapper of it) over Node's http module. Used by the QA server and the
// e2e stack; production runs the Start server its own way (docs/runbooks/server.md).
import type { IncomingMessage, ServerResponse } from "node:http";

export function nodeHandler(fetchHandler: (req: Request) => Promise<Response>) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const method = req.method ?? "GET";
    const body = chunks.length && method !== "GET" && method !== "HEAD" ? Buffer.concat(chunks) : undefined;
    const response = await fetchHandler(new Request(`http://${req.headers.host}${req.url}`, { method, headers, body }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}
