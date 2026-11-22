// Correlation ids (plan section 6.2): propagated from the surface in X-Correlation-Id, or generated here.
import { randomUUID } from "node:crypto";

export const CORRELATION_HEADER = "x-correlation-id";
const VALID = /^[A-Za-z0-9._-]{8,64}$/;

export function correlationIdFrom(header: string | null): string {
  return header !== null && VALID.test(header) ? header : randomUUID();
}
