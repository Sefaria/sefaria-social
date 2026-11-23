// Values the global setup provides to the integration test files (vitest provide/inject).
import type { JWK } from "jose";

declare module "vitest" {
  interface ProvidedContext {
    databaseUrl: string;
    jwksUrl: string;
    issuer: string;
    kid: string;
    privateJwk: JWK;
  }
}

export {};
