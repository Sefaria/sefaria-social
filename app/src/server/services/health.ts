// Health (plan section 6.2): the database and nothing else. No call to Django, the JWKS or the relay, so a downstream outage
// never takes the server out of the load balancer.
import type pg from "pg";
import { getPool } from "../db/client";
import { log } from "../log/logger";

export const HEALTH_TIMEOUT_MS = 2_000;

export type HealthResult =
  | { status: 200; body: { status: "ok"; database: "ok" } }
  | { status: 503; body: { status: "unavailable"; database: "unavailable" } };

export async function checkHealth(
  pool: Pick<pg.Pool, "query"> = getPool(),
  timeoutMs = HEALTH_TIMEOUT_MS,
): Promise<HealthResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("health check timed out")), timeoutMs);
  });
  try {
    await Promise.race([pool.query("select 1"), timeout]);
    return { status: 200, body: { status: "ok", database: "ok" } };
  } catch (e) {
    log.warn("db.health_failed", { error: e instanceof Error ? e.name : "unknown" });
    return { status: 503, body: { status: "unavailable", database: "unavailable" } };
  } finally {
    clearTimeout(timer);
  }
}
