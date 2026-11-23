#!/usr/bin/env node
// The agent-QA environment, built inside the job (plan 5.5 L5a): Postgres (a service container in agent-qa.yml), the social
// server, the harness and a local relay, each started from a root package.json script when that script exists. Components that
// are not built yet are recorded as "not-built" with the milestone that adds them, so the runner reports "cannot reach" with a
// reason instead of passing. Contract (e2e/qa/README.md): scripts `qa:server`, `qa:harness`, `qa:relay`, `qa:seed`, `qa:reset`.
//
//   node e2e/qa/env.mjs up [--out qa/env.json]            start what exists, wait for health, write the environment file
//   node e2e/qa/env.mjs fallback-evidence <surfaces.json> <env.json> [--out qa/evidence.json]
//        evidence for a run whose runner produced none: every derived surface is "cannot reach" with the reason
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const COMPONENTS = [
  { name: "server", script: "qa:server", health: "http://127.0.0.1:3200/api/health", milestone: "P2 (server and identity)" },
  { name: "harness", script: "qa:harness", health: "http://127.0.0.1:3300/", milestone: "P1 (harness)" },
  { name: "relay", script: "qa:relay", health: "http://127.0.0.1:8787/health", milestone: "P3 (relay)" },
];

const opt = (args, f, d) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : d);

async function healthy(url, deadline) {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (r.ok) return true;
    } catch {
      // not up yet; poll again
    }
    await new Promise((res) => setTimeout(res, 1_000));
  }
  return false;
}

export async function up(root, { timeoutMs = 90_000, env = process.env } = {}) {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const result = { name: env.QA_ENVIRONMENT || "qa-local", components: {} };
  mkdirSync(path.join(root, "qa/logs"), { recursive: true });
  for (const c of COMPONENTS) {
    if (!pkg.scripts?.[c.script]) {
      result.components[c.name] = { status: "not-built", reason: `no '${c.script}' script yet; arrives with ${c.milestone}` };
      continue;
    }
    const log = path.join(root, "qa/logs", `${c.name}.log`);
    const fd = openSync(log, "a");
    const child = spawn("npm", ["run", c.script], { cwd: root, env, stdio: ["ignore", fd, fd], detached: true });
    child.unref();
    closeSync(fd);
    const ok = await healthy(c.health, Date.now() + timeoutMs);
    result.components[c.name] = ok
      ? { status: "up", url: c.health.replace(/\/(api\/)?health$|\/$/, ""), pid: child.pid }
      : {
          status: "failed",
          reason: `'${c.script}' did not answer ${c.health} within ${timeoutMs / 1000}s; see ${path.relative(root, log)}`,
        };
  }
  return result;
}

export function fallbackEvidence(surfaces, envFile, reason = "the QA runner produced no evidence") {
  const down = Object.entries(envFile?.components ?? {})
    .filter(([, c]) => c.status !== "up")
    .map(([n, c]) => `${n}: ${c.reason ?? c.status}`);
  return {
    sha: process.env.GITHUB_SHA ?? "",
    pr: Number(process.env.PR_NUMBER) || null,
    planned_surfaces: [],
    journeys: Object.keys(surfaces?.surfaces ?? {}).map((s, i) => ({
      id: `J-${String(i + 1).padStart(3, "0")}`,
      surface: s,
      persona: "none",
      title: `reach ${s}`,
      planned: false,
      attempts: [],
      cannot_reach: `${reason}${down.length ? `; environment: ${down.join("; ")}` : ""}`,
    })),
  };
}

async function main(argv) {
  const [cmd, ...args] = argv;
  const root = process.cwd();
  if (cmd === "up") {
    const out = opt(args, "--out", "qa/env.json");
    const r = await up(root);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(r, null, 2));
    for (const [n, c] of Object.entries(r.components)) console.log(`qa env: ${n} ${c.status}${c.reason ? ` (${c.reason})` : ""}`);
    return 0;
  }
  if (cmd === "fallback-evidence") {
    const [surfacesFile, envPath] = args.filter((a) => !a.startsWith("--"));
    const read = (f) => (f && existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {});
    const out = opt(args, "--out", "qa/evidence.json");
    writeFileSync(out, JSON.stringify(fallbackEvidence(read(surfacesFile), read(envPath)), null, 2));
    console.log(`qa env: wrote fallback evidence to ${out}`);
    return 0;
  }
  console.error("usage: env.mjs up [--out qa/env.json] | env.mjs fallback-evidence <surfaces.json> <env.json> [--out f]");
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main(process.argv.slice(2));
