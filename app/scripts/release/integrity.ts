// Subresource Integrity, computed the way browsers check it: any one of the listed digests must match the bytes.
import { createHash } from "node:crypto";

export function sri(body: Uint8Array, alg: "sha256" | "sha384" | "sha512" = "sha384"): string {
  return `${alg}-${createHash(alg).update(body).digest("base64")}`;
}

/** True when `body` matches at least one digest of the SRI value ("sha384-… sha512-…"). */
export function matchesIntegrity(body: Uint8Array, integrity: string): boolean {
  return integrity
    .trim()
    .split(/\s+/)
    .some((token) => {
      const m = token.match(/^(sha256|sha384|sha512)-(.+)$/);
      return !!m && sri(body, m[1] as "sha256" | "sha384" | "sha512") === token;
    });
}
