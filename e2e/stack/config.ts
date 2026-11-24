// Ports and fixed test values of the local e2e stack (e2e/stack/start.ts). Nothing here is a real secret.
const harnessPort = Number(process.env.HARNESS_PORT) || 3300;

export const STACK = {
  // Overridable so the e2e stack can run beside a developer's own servers on the default ports.
  apiPort: Number(process.env.E2E_API_PORT) || 3200,
  relayPort: Number(process.env.E2E_RELAY_PORT) || 8787,
  jwksPort: Number(process.env.E2E_JWKS_PORT) || 3299,
  kid: "e2e-key",
  issuer: `http://localhost:${Number(process.env.E2E_JWKS_PORT) || 3299}`,
  jwksUrl: `http://127.0.0.1:${Number(process.env.E2E_JWKS_PORT) || 3299}/.well-known/sefaria-social-jwks.json`,
  relaySecret: "e2e-relay-secret",
  /** LiveKit in development mode (spec 040): its fixed development key pair, not a secret. */
  livekitPort: Number(process.env.E2E_LIVEKIT_PORT) || 7880,
  livekitImage: "livekit/livekit-server:v1.13.11",
  livekitKey: "devkey",
  livekitSecret: "secret",
  /** The harness page's origins (CORS for the API, Origin allowlist for the relay). */
  pageOrigins: [`http://localhost:${harnessPort}`, `http://127.0.0.1:${harnessPort}`],
  databaseUrl: process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/sefaria_social_e2e_test",
} as const;
