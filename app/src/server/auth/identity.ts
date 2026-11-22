// The caller's identity, from the claims of Django's social token (plan section 6.1; contract in Sefaria-Project sso/).
import { z } from "zod";

/** Claims beyond what jose checks (signature, alg, iss, aud, exp). `sub` is str(auth_user.id); never the username. */
export const SocialTokenClaims = z.object({
  sub: z.string().regex(/^[1-9][0-9]{0,15}$/, "sub must be a positive integer"),
  name: z.string().max(500).default(""),
  picture: z
    .url({ protocol: /^https?$/ })
    .max(2000)
    .optional(),
  staff: z.boolean().default(false),
});

export interface Identity {
  /** Sefaria auth_user.id */
  userId: number;
  name: string;
  picture: string | null;
  staff: boolean;
}

export function identityFromClaims(claims: unknown): Identity | null {
  const parsed = SocialTokenClaims.safeParse(claims);
  if (!parsed.success) return null;
  const userId = Number(parsed.data.sub);
  if (!Number.isSafeInteger(userId)) return null;
  return { userId, name: parsed.data.name.trim(), picture: parsed.data.picture ?? null, staff: parsed.data.staff };
}
