// Fixed local values shared by the QA server and the QA relay (e2e/qa/README.md: server 127.0.0.1:3200, harness :3300, relay
// :8787). Nothing here is a real secret; QA_PERSONA_SECRET comes from the environment (a random value per run).
export const QA = {
  apiPort: 3200,
  relayPort: 8787,
  harnessOrigins: (process.env.QA_HARNESS_ORIGINS ?? "http://127.0.0.1:3300,http://localhost:3300").split(","),
  issuer: process.env.SOCIAL_TOKEN_ISSUER ?? "http://127.0.0.1:3200/qa",
  jwksUrl: "http://127.0.0.1:3200/api/test/jwks",
  relaySecret: process.env.RELAY_INTERNAL_SECRET ?? "qa-relay-secret",
} as const;
