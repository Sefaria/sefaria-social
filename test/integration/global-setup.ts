// Global setup for the `integration` Vitest project (L2, plan section 5.5): a real Postgres database migrated from empty,
// an RSA key generated now (never stored), and a local JWKS server that publishes its public half, so tokens are verified
// exactly as in production (jose fetching a JWKS over HTTP). Values reach the test files through `provide`/`inject`.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { TestProject } from "vitest/node";
import { exportJWK, generateKeyPair } from "jose";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { runMigrations } from "../../app/src/server/db/migrate";
import "./context";

export const TEST_ISSUER = "https://sefaria.test";
export const DEFAULT_TEST_DATABASE_URL = "postgres://localhost:5432/sefaria_social_test";

let server: Server | undefined;

/** Create the database if needed and reset it to empty. Refuses any database whose name does not contain "test". */
async function freshDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!/test/i.test(name))
    throw new Error(
      `Refusing to reset database "${name}": the integration tests only use a database whose name contains "test".`,
    );
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const adminClient = new pg.Client({ connectionString: admin.toString() });
  await adminClient.connect();
  try {
    const exists = await adminClient.query("select 1 from pg_database where datname = $1", [name]);
    if (exists.rowCount === 0) await adminClient.query(`create database "${name.replace(/"/g, '""')}"`);
  } finally {
    await adminClient.end();
  }
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    await pool.query("drop schema if exists drizzle cascade; drop schema public cascade; create schema public;");
    await runMigrations(drizzle(pool));
  } finally {
    await pool.end();
  }
}

export default async function setup(project: TestProject) {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  await freshDatabase(databaseUrl);

  const kid = "test-key-1";
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  const privateJwk = { ...(await exportJWK(privateKey)), kid, alg: "RS256" };

  server = createServer((req, res) => {
    if (req.url !== "/.well-known/sefaria-social-jwks.json") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json", "cache-control": "public, max-age=300" });
    res.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  project.provide("databaseUrl", databaseUrl);
  project.provide("jwksUrl", `http://127.0.0.1:${port}/.well-known/sefaria-social-jwks.json`);
  project.provide("issuer", TEST_ISSUER);
  project.provide("kid", kid);
  project.provide("privateJwk", privateJwk);

  return async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  };
}
