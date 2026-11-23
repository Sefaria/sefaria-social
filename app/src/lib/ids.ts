import { z } from "zod";

/** Room and shiur ids (routing rule R6): the relay's path rule, 8–128 of A–Z, a–z, 0–9, "_" and "-". */
export const ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
export const idSchema = z.string().regex(ID_RE, "an id of 8–128 letters, digits, _ or -");
export type Id = z.infer<typeof idSchema>;

export const isId = (value: unknown): value is Id => typeof value === "string" && ID_RE.test(value);
