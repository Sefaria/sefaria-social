// `npm run qa:server` (after `npm run build`): the social server for agent QA (e2e/qa/README.md) on 127.0.0.1:3200. It is the
// built Start server with the test-only persona routes in front (app/src/server/qa/personas.ts, spec 082), which the
// production build never contains. Refuses to start unless SOCIAL_ENV matches ^test(-|$). Persona tokens are signed by a key
// generated at start, published at /api/test/jwks, which this server (and the QA relay) verify against.
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exportJWK, generateKeyPair } from "jose";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { runMigrations } from "../src/server/db/migrate";
import { environmentAllows, withQaRoutes } from "../src/server/qa/personas";
import { nodeHandler } from "./node-serve";
import { QA } from "./qa-config";

if (!environmentAllows(process.env.SOCIAL_ENV)) {
  console.error("qa:server runs only with SOCIAL_ENV=test or test-<anything> (it issues persona sessions).");
  process.exit(2);
}
const databaseUrl = process.env.DATABASE_URL ?? "postgres://localhost:5432/sefaria_social_qa_test";
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
await runMigrations(drizzle(pool));
await pool.end();

const kid = "qa-key";
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  SOCIAL_JWKS_URL: QA.jwksUrl,
  SOCIAL_TOKEN_ISSUER: QA.issuer,
  SOCIAL_ALLOWED_ORIGINS: process.env.SOCIAL_ALLOWED_ORIGINS ?? QA.harnessOrigins.join(","),
  RELAY_INTERNAL_URL: process.env.RELAY_INTERNAL_URL ?? `http://127.0.0.1:${QA.relayPort}`,
  RELAY_INTERNAL_SECRET: QA.relaySecret,
});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = (await import(pathToFileURL(path.join(root, "dist", "server", "server.js")).href)).default as {
  fetch(req: Request): Promise<Response>;
};
const handler = withQaRoutes((req) => server.fetch(req), {
  environment: process.env.SOCIAL_ENV,
  secret: process.env.QA_PERSONA_SECRET,
  signing: { key: privateKey, kid, publicJwk: await exportJWK(publicKey), issuer: QA.issuer, audience: "sefaria-social" },
  harnessOrigin: QA.harnessOrigins[0]!,
  corsOrigins: [...QA.harnessOrigins],
});
createServer(nodeHandler(handler)).listen(QA.apiPort, "127.0.0.1", () =>
  console.log(`qa:server on http://127.0.0.1:${QA.apiPort} (SOCIAL_ENV=${process.env.SOCIAL_ENV})`),
);
