// Acceptance tests for spec 022 (Coolify deployment). File reads and one run of the relay's start script, so they load on the
// merge base (where the files do not exist) and fail there on an assertion. Building and running the images needs Docker; that
// was done by hand and is recorded in docs/runbooks/previews.md.
// @feature OPS-022 Coolify deployment with a preview per pull request
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { REPO } from "./helpers.mjs";

const read = (rel) => {
  const file = path.join(REPO, rel);
  expect(existsSync(file), `${rel} exists`).toBe(true);
  return readFileSync(file, "utf8");
};
const PINNED_FROM = /^FROM\s+\S+:[^\s@]+@sha256:[0-9a-f]{64}(\s+AS\s+\S+)?\s*$/i;
const fromLines = (text) => text.split("\n").filter((l) => /^FROM\s/i.test(l));
const finalUser = (text) => {
  const lines = text.split("\n");
  const last = lines
    .map((l, i) => (/^FROM\s/i.test(l) ? i : -1))
    .filter((i) => i >= 0)
    .pop();
  return lines
    .slice(last)
    .filter((l) => /^USER\s/i.test(l))
    .map((l) => l.split(/\s+/)[1])
    .pop();
};
/** Every value in the service's environment that looks like a secret must be a ${VARIABLE} reference. */
const SECRETISH = /(PASSWORD|SECRET|TOKEN|KEY)$/;

describe("spec 022: Coolify deployment", () => {
  // @ac 022/AC-001
  it("the compose file defines app, surface, relay and postgres, migrates before serving, and takes every secret from a variable", () => {
    const compose = YAML.parse(read("docker-compose.coolify.yml"));
    expect(Object.keys(compose.services ?? {}).sort()).toEqual(["app", "postgres", "relay", "surface"]);
    const { app, postgres, relay } = compose.services;
    expect(app.build).toMatchObject({ context: ".", dockerfile: "Dockerfile" });
    expect(app.command.join(" ")).toMatch(/node app\/scripts\/migrate\.mjs && exec node app\/scripts\/start\.mjs/);
    expect(app.environment.DATABASE_URL).toMatch(/@postgres:5432\//);
    expect(app.environment.RELAY_INTERNAL_URL).toBe("http://relay:8787");
    expect(app.depends_on).toEqual({ postgres: { condition: "service_healthy" } });
    expect(postgres.image).toMatch(/^postgres:[^@\s]+@sha256:[0-9a-f]{64}$/);
    expect(postgres.healthcheck?.test?.join(" ")).toMatch(/pg_isready/);
    for (const [name, svc] of Object.entries(compose.services)) {
      for (const [key, value] of Object.entries(svc.environment ?? {})) {
        if (SECRETISH.test(key)) expect(String(value), `${name}.${key}`).toMatch(/^\$\{[A-Z0-9_]+\}$/);
      }
    }
    expect(app.environment.DATABASE_URL).toContain("${SERVICE_PASSWORD_POSTGRES}");
    expect(app.environment.RELAY_INTERNAL_SECRET).toBe(relay.environment.RELAY_INTERNAL_SECRET);
  });

  // @ac 022/AC-002
  it("the surface image serves the release build: no-cache manifest, immutable assets, any origin, non-root, pinned, healthy from the manifest", () => {
    const docker = read("deploy/coolify/surface.Dockerfile");
    const froms = fromLines(docker);
    expect(froms.length).toBeGreaterThanOrEqual(2);
    for (const f of froms) expect(f, f).toMatch(PINNED_FROM);
    expect(docker).toMatch(/npm run build:surface/);
    expect(docker).toMatch(/COPY --from=build \/src\/app\/dist-surface /);
    expect(finalUser(docker)).toBeTruthy();
    expect(finalUser(docker)).not.toMatch(/^(root|0)$/);
    expect(docker).toMatch(/HEALTHCHECK[\s\S]*manifest\.json/);
    const conf = read("deploy/coolify/surface-nginx.conf");
    const block = (loc) => conf.slice(conf.indexOf(loc), conf.indexOf("}", conf.indexOf(loc)));
    expect(block("location = /manifest.json")).toMatch(/Cache-Control "no-cache"/);
    expect(block("location /assets/")).toMatch(/Cache-Control "public, max-age=31536000, immutable"/);
    for (const loc of ["location = /manifest.json", "location /assets/"])
      expect(block(loc), loc).toMatch(/Access-Control-Allow-Origin "\*" always/);
  });

  // @ac 022/AC-003
  it("the relay image runs the Worker from its environment, refuses to start without its settings, non-root, pinned, healthy from /health", () => {
    const docker = read("deploy/coolify/relay.Dockerfile");
    for (const f of fromLines(docker)) expect(f, f).toMatch(PINNED_FROM);
    expect(finalUser(docker)).not.toMatch(/^(root|0)?$/);
    expect(docker).toMatch(/HEALTHCHECK[\s\S]*\/health/);
    for (const name of ["ALLOWED_ORIGINS", "JWKS_URL", "TOKEN_ISSUER", "RELAY_INTERNAL_SECRET"]) {
      expect(docker, `${name} is not baked into the image`).not.toMatch(new RegExp(`(ENV|ARG)\\s+[^\\n]*\\b${name}\\b`));
    }
    const start = read("deploy/coolify/relay-start.sh");
    expect(start).toMatch(/wrangler dev/);
    const env = { PATH: process.env.PATH, HOME: process.env.HOME };
    const r = spawnSync("sh", [path.join(REPO, "deploy/coolify/relay-start.sh")], { env, encoding: "utf8", timeout: 10_000 });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/ALLOWED_ORIGINS is required/);
  });
});
