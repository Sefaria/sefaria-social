// Tokens for e2e personas, signed with the key the stack's JWKS publishes (read from test-results/e2e-stack.json), shaped like
// Django's (plan 6.1). Invented people only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { importJWK, SignJWT, type JWK } from "jose";

export interface Persona {
  id: number;
  name: string;
}

export async function tokenFor(persona: Persona): Promise<string> {
  const stack = JSON.parse(readFileSync(path.resolve("test-results", "e2e-stack.json"), "utf8")) as {
    privateJwk: JWK;
    kid: string;
    issuer: string;
  };
  const key = await importJWK(stack.privateJwk, "RS256");
  return new SignJWT({ name: persona.name, staff: false, jti: crypto.randomUUID() })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: stack.kid })
    .setIssuer(stack.issuer)
    .setAudience("sefaria-social")
    .setSubject(String(persona.id))
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(key);
}
