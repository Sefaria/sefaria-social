// The local stack for the multi-user journeys (spec 014, L4a): Postgres migrated from empty, an RSA key generated now and
// published by a local JWKS server (playing Django's), the built Start server (dist/server/server.js) serving the API, and
// the relay under `wrangler dev` (workerd). Playwright starts it as a web server and waits for the API's health check, which
// answers only once the relay is up. Tests read e2e-stack.json (in test-results/) to mint tokens with the same key.
//
//   npx tsx e2e/stack/start.ts     (after `npm run build`; needs Postgres: E2E_DATABASE_URL, default a local *_e2e_test db)
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exportJWK, generateKeyPair } from "jose";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { runMigrations } from "../../app/src/server/db/migrate";
import { STACK } from "./config";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const children: ChildProcess[] = [];
const stop = () => {
  for (const c of children) c.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

/** Create the database if needed and reset it to empty. Refuses a database whose name does not contain "test". */
async function freshDatabase(url: string) {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!/test/i.test(name)) throw new Error(`Refusing to reset database "${name}": its name must contain "test".`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query("select 1 from pg_database where datname = $1", [name]);
    if (exists.rowCount === 0) await client.query(`create database "${name.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    await pool.query("drop schema if exists drizzle cascade; drop schema public cascade; create schema public;");
    await runMigrations(drizzle(pool));
  } finally {
    await pool.end();
  }
}

async function waitFor(url: string, ms: number) {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > until) throw new Error(`${url} did not come up within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Node http → the Start server's fetch handler. */
function serveFetch(handler: { fetch(req: Request): Promise<Response> }) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const method = req.method ?? "GET";
    const body = chunks.length && method !== "GET" && method !== "HEAD" ? Buffer.concat(chunks) : undefined;
    const response = await handler.fetch(new Request(`http://${req.headers.host}${req.url}`, { method, headers, body }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}

await freshDatabase(STACK.databaseUrl);

const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...(await exportJWK(publicKey)), kid: STACK.kid, alg: "RS256", use: "sig" };
const jwks = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ keys: [jwk] }));
});
await new Promise<void>((resolve) => jwks.listen(STACK.jwksPort, "127.0.0.1", resolve));
mkdirSync(path.join(root, "test-results"), { recursive: true });
writeFileSync(
  path.join(root, "test-results", "e2e-stack.json"),
  JSON.stringify({ privateJwk: await exportJWK(privateKey), kid: STACK.kid, issuer: STACK.issuer }),
);

const relay = spawn(
  path.join(root, "node_modules", ".bin", "wrangler"),
  [
    "dev",
    "--port",
    String(STACK.relayPort),
    "--ip",
    "127.0.0.1",
    "--var",
    `ALLOWED_ORIGINS:${STACK.pageOrigins.join(",")}`,
    "--var",
    `JWKS_URL:${STACK.jwksUrl}`,
    "--var",
    `TOKEN_ISSUER:${STACK.issuer}`,
    "--var",
    `RELAY_INTERNAL_SECRET:${STACK.relaySecret}`,
  ],
  {
    cwd: path.join(root, "packages", "relay"),
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" },
  },
);
children.push(relay);
relay.on("exit", (code) => {
  if (code) {
    console.error(`e2e stack: wrangler dev exited with ${code}`);
    process.exit(1);
  }
});
await waitFor(`http://127.0.0.1:${STACK.relayPort}/health`, 90_000);

Object.assign(process.env, {
  DATABASE_URL: STACK.databaseUrl,
  SOCIAL_JWKS_URL: STACK.jwksUrl,
  SOCIAL_TOKEN_ISSUER: STACK.issuer,
  SOCIAL_TOKEN_AUDIENCE: "sefaria-social",
  SOCIAL_ALLOWED_ORIGINS: STACK.pageOrigins.join(","),
  RELAY_INTERNAL_URL: `http://127.0.0.1:${STACK.relayPort}`,
  RELAY_INTERNAL_SECRET: STACK.relaySecret,
  USER_DELETED_WEBHOOK_SECRET: "e2e-webhook-secret",
  LOG_LEVEL: "warn",
});
const server = (await import(pathToFileURL(path.join(root, "app", "dist", "server", "server.js")).href)).default;
createServer(serveFetch(server)).listen(STACK.apiPort, "127.0.0.1", () =>
  console.log(`e2e stack: API http://127.0.0.1:${STACK.apiPort}, relay ws://127.0.0.1:${STACK.relayPort}`),
);
