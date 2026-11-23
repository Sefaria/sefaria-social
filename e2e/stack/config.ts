// Ports and fixed test values of the local e2e stack (e2e/stack/start.ts). Nothing here is a real secret.
const harnessPort = Number(process.env.HARNESS_PORT) || 3300;

export const STACK = {
  apiPort: 3200,
  relayPort: 8787,
  jwksPort: 3299,
  kid: "e2e-key",
  issuer: "http://localhost:3299",
  jwksUrl: "http://127.0.0.1:3299/.well-known/sefaria-social-jwks.json",
  relaySecret: "e2e-relay-secret",
  /** The harness page's origins (CORS for the API, Origin allowlist for the relay). */
  pageOrigins: [`http://localhost:${harnessPort}`, `http://127.0.0.1:${harnessPort}`],
  databaseUrl: process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/sefaria_social_e2e_test",
} as const;
