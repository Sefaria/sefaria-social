// Structured logging (plan section 6.2): one JSON line per event on stdout. The message is a member of a fixed list, so it
// is always a static string; fields are scalars. Request headers, bodies and tokens are never passed here, and any field
// whose name suggests one is redacted anyway, so a mistake does not leak a secret.

export const LOG_EVENTS = [
  "request.completed",
  "request.failed",
  "auth.not_configured",
  "auth.jwks_unavailable",
  "db.health_failed",
  "webhook.not_configured",
  "webhook.user_deleted.processed",
  "webhook.user_deleted.duplicate",
  "webhook.ignored",
  "user.purged",
  "relay.status_failed",
  "relay.drop_failed",
  "livekit.remove_failed",
  "asset.processed",
  "asset.process_failed",
  "asset.worker_failed",
  "asset.sweep_failed",
  "transcript.ready",
  "transcript.failed",
  "transcript.submit_failed",
  "transcript.poll_failed",
  "transcript.rate_limited",
  "invite.lookup_failed",
  "invite.email_failed",
] as const;
export type LogEvent = (typeof LOG_EVENTS)[number];
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const REDACT_KEY = /authorization|cookie|token|secret|password|signature|body|header/i;
const MAX_STRING = 200;

type Sink = (line: string) => void;
const stdout: Sink = (line) => process.stdout.write(`${line}\n`);
let sink: Sink = stdout;
let minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";

/** Replace where lines go (tests capture them). `null` restores stdout. */
export function setLogSink(next: Sink | null): void {
  sink = next ?? stdout;
}

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function clean(fields: LogFields): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (REDACT_KEY.test(k)) out[k] = "[redacted]";
    else if (typeof v === "string" && v.length > MAX_STRING) out[k] = `${v.slice(0, MAX_STRING)}…`;
    else out[k] = v;
  }
  return out;
}

function write(level: LogLevel, msg: LogEvent, fields: LogFields = {}): void {
  if (LEVELS[level] < LEVELS[minLevel]) return;
  sink(JSON.stringify({ time: new Date().toISOString(), level, msg, ...clean(fields) }));
}

export const log = {
  debug: (msg: LogEvent, fields?: LogFields) => write("debug", msg, fields),
  info: (msg: LogEvent, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: LogEvent, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: LogEvent, fields?: LogFields) => write("error", msg, fields),
};
