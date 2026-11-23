// `npm run qa:relay`: the relay for agent QA (e2e/qa/README.md) under `wrangler dev` on 127.0.0.1:8787, verifying tokens
// against the QA server's test JWKS and accepting the harness's origins.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QA } from "./qa-config";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const vars = {
  ALLOWED_ORIGINS: QA.harnessOrigins.join(","),
  JWKS_URL: QA.jwksUrl,
  TOKEN_ISSUER: QA.issuer,
  RELAY_INTERNAL_SECRET: QA.relaySecret,
};
const child = spawn(
  path.join(root, "node_modules", ".bin", "wrangler"),
  [
    "dev",
    "--port",
    String(QA.relayPort),
    "--ip",
    "127.0.0.1",
    ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`]),
  ],
  { cwd: path.join(root, "packages", "relay"), stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
);
const stop = () => child.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (code) => process.exit(code ?? 0));
