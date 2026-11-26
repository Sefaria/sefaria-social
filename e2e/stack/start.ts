// The local stack for the multi-user journeys (spec 014, L4a): Postgres migrated from empty, an RSA key generated now and
// published by a local JWKS server (playing Django's), the built Start server (dist/server/server.js) serving the API, and
// the relay under `wrangler dev` (workerd), and LiveKit in development mode for calls (spec 040). Playwright starts it as a web server and waits for the API's health check, which
// answers only once the relay is up. Tests read e2e-stack.json (in test-results/) to mint tokens with the same key.
//
//   npx tsx e2e/stack/start.ts     (after `npm run build`; needs Postgres: E2E_DATABASE_URL, default a local *_e2e_test db)
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exportJWK, generateKeyPair } from "jose";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { runMigrations } from "../../app/src/server/db/migrate";
import { nodeHandler } from "../../app/scripts/node-serve";
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
    // Live reports to the API (spec 056); it listens below, after the relay is up, and the relay retries on the next change.
    "--var",
    `SOCIAL_SERVER_URL:http://127.0.0.1:${STACK.apiPort}`,
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

// LiveKit in development mode (spec 040): the livekit-server binary when it is on the PATH, else its container. Media uses
// 7881/tcp and 7882/udp. --node-ip is the machine's own network address, not 127.0.0.1: Chromium gathers no loopback ICE
// candidates, so media to a server that advertises loopback never connects (signalling does, publishing then hangs).
const nodeIp =
  Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address ?? "127.0.0.1";
const hasBinary = spawnSync("livekit-server", ["--version"], { stdio: "ignore" }).status === 0;
const livekit = hasBinary
  ? spawn("livekit-server", ["--dev", "--bind", "0.0.0.0", "--node-ip", nodeIp, "--port", String(STACK.livekitPort)], {
      stdio: ["ignore", "ignore", "inherit"],
    })
  : spawn(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        `social-e2e-livekit-${process.pid}`,
        "-p",
        `${STACK.livekitPort}:7880`,
        "-p",
        "7881:7881",
        "-p",
        "7882:7882/udp",
        STACK.livekitImage,
        "--dev",
        "--bind",
        "0.0.0.0",
        "--node-ip",
        nodeIp,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
children.push(livekit);
if (!hasBinary)
  process.on("exit", () => spawnSync("docker", ["rm", "-f", `social-e2e-livekit-${process.pid}`], { stdio: "ignore" }));
livekit.on("exit", (code) => {
  if (code) {
    console.error(`e2e stack: LiveKit exited with ${code}`);
    process.exit(1);
  }
});
await waitFor(`http://127.0.0.1:${STACK.livekitPort}`, 120_000);

Object.assign(process.env, {
  DATABASE_URL: STACK.databaseUrl,
  SOCIAL_JWKS_URL: STACK.jwksUrl,
  SOCIAL_TOKEN_ISSUER: STACK.issuer,
  SOCIAL_TOKEN_AUDIENCE: "sefaria-social",
  SOCIAL_ALLOWED_ORIGINS: STACK.pageOrigins.join(","),
  RELAY_INTERNAL_URL: `http://127.0.0.1:${STACK.relayPort}`,
  RELAY_INTERNAL_SECRET: STACK.relaySecret,
  USER_DELETED_WEBHOOK_SECRET: "e2e-webhook-secret",
  LIVEKIT_URL: `ws://127.0.0.1:${STACK.livekitPort}`,
  LIVEKIT_API_KEY: STACK.livekitKey,
  LIVEKIT_API_SECRET: STACK.livekitSecret,
  CALLS_ENABLED: "true",
  LOG_LEVEL: "warn",
});
const server = (await import(pathToFileURL(path.join(root, "app", "dist", "server", "server.js")).href)).default;
createServer(nodeHandler((req) => server.fetch(req))).listen(STACK.apiPort, "127.0.0.1", () =>
  console.log(`e2e stack: API http://127.0.0.1:${STACK.apiPort}, relay ws://127.0.0.1:${STACK.relayPort}`),
);
