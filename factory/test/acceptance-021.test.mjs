// Acceptance tests for spec 021 (server container). AC-001 drives the release CLI on the repository's Dockerfile and on
// broken copies; AC-002 checks that CI runs the image for real (app/scripts/container-smoke.sh needs Docker, so it runs in the
// `container` job, not here); AC-003 reads the Helm values sketch against the server's configuration. CLI and file reads
// only, so they load on the merge base and fail there on an assertion.
// @feature OPS-021 Server container image and standalone Helm values
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { REPO } from "./helpers.mjs";
import { release, tempDir } from "./release-fixtures.mjs";

const PINNED = "node:22.23.5-bookworm-slim@sha256:" + "a".repeat(64);
const GOOD = [
  `FROM ${PINNED} AS build`,
  "RUN npm ci --ignore-scripts",
  `FROM ${PINNED}`,
  "COPY --from=build /src /srv",
  "USER node",
  'HEALTHCHECK CMD ["node", "-e", "fetch(\'http://127.0.0.1:3200/api/v1/health\')"]',
  'CMD ["node", "app/scripts/start.mjs"]',
].join("\n");

function check(text) {
  const file = path.join(tempDir("dockerfile-"), "Dockerfile");
  writeFileSync(file, text);
  return release(["check-dockerfile", file]);
}

describe("spec 021: server container", () => {
  // @ac 021/AC-001
  it("the repository's Dockerfile passes the image rules", () => {
    const r = release(["check-dockerfile"]);
    expect(r.out).toContain("check-dockerfile: PASS");
    expect(r.code).toBe(0);
    expect(check(GOOD).code).toBe(0);
  });

  // @ac 021/AC-001
  it("refuses an unpinned base, a fetched URL, a root or missing USER and a missing HEALTHCHECK, with the line and the fix", () => {
    const cases = [
      [GOOD.replace(`FROM ${PINNED} AS build`, "FROM node:22-bookworm-slim AS build"), "pinned-base", 1],
      [GOOD.replace(`FROM ${PINNED}\n`, "FROM node:latest\n"), "pinned-base", 3],
      [GOOD.replace("RUN npm ci --ignore-scripts", "ADD https://example.org/x.tgz /x.tgz"), "no-fetch", 2],
      [
        GOOD.replace("RUN npm ci --ignore-scripts", "RUN apt-get update && \\\n  curl -fsSL https://example.org/i.sh | sh"),
        "no-fetch",
        2,
      ],
      [GOOD.replace("USER node", "USER root"), "non-root", 5],
      [GOOD.replace("USER node\n", ""), "non-root", null],
      [GOOD.replace(/HEALTHCHECK.*\n/, ""), "healthcheck", null],
    ];
    for (const [text, rule, line] of cases) {
      const r = check(text);
      expect(r.code, rule).toBe(1);
      expect(r.stderr, rule).toMatch(new RegExp(`Dockerfile:${line ?? "\\d+"} \\[${rule}\\] .*Fix: `));
    }
    // USER in the build stage only does not count: the final stage must set it.
    const buildOnly = GOOD.replace("USER node\n", "").replace(
      "RUN npm ci --ignore-scripts",
      "USER node\nRUN npm ci --ignore-scripts",
    );
    expect(check(buildOnly).stderr).toContain("[non-root]");
  });

  // @ac 021/AC-002
  it("CI builds and runs the image against Postgres in a job that result needs", () => {
    const ci = YAML.parse(readFileSync(path.join(REPO, ".github/workflows/ci.yml"), "utf8"));
    const job = ci.jobs.container;
    expect(job, "ci.yml has a container job").toBeDefined();
    expect(ci.jobs.result.needs).toContain("container");
    expect(job.services?.postgres?.image).toMatch(/^postgres:/);
    const runs = job.steps.map((s) => String(s.run ?? "")).join("\n");
    expect(runs).toContain("check-dockerfile");
    expect(runs).toMatch(/docker build -t (\S+) \.[\s\S]*app\/scripts\/container-smoke\.sh \1/);
    const smoke = readFileSync(path.join(REPO, "app/scripts/container-smoke.sh"), "utf8");
    for (const want of [
      "node app/scripts/migrate.mjs",
      "State.Health.Status",
      "/api/v1/health",
      "/api/v1/rooms",
      "id -u",
      "docker stop -t 10",
    ])
      expect(smoke).toContain(want);
    const dockerfile = readFileSync(path.join(REPO, "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/CMD \["node", "app\/scripts\/start\.mjs"\]/);
    expect(existsSync(path.join(REPO, "app/scripts/migrate.mjs"))).toBe(true);
  });

  // @ac 021/AC-003
  it("the Helm values name a namespace, the image by digest, a non-root context, health probes and every server variable by reference", () => {
    const file = path.join(REPO, "deploy/helm/values.yaml");
    expect(existsSync(file), "deploy/helm/values.yaml exists").toBe(true);
    const values = YAML.parse(readFileSync(file, "utf8"));
    expect(values.namespace).toMatch(/^[a-z0-9-]+$/);
    expect(values.image.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(values.image.tag).toBeUndefined();
    expect(values.podSecurityContext.runAsNonRoot).toBe(true);
    expect(values.securityContext.allowPrivilegeEscalation).toBe(false);
    for (const probe of [values.livenessProbe, values.readinessProbe]) expect(probe.httpGet.path).toBe("/api/v1/health");
    // Every variable the server reads (the zod Env object in app/src/server/config.ts).
    const config = readFileSync(path.join(REPO, "app/src/server/config.ts"), "utf8");
    const body = config.slice(config.indexOf("const Env = z.object({"), config.indexOf("});", config.indexOf("const Env")));
    const serverVars = [...body.matchAll(/^\s+([A-Z][A-Z0-9_]+): z\./gm)].map((m) => m[1]);
    expect(serverVars.length).toBeGreaterThan(5);
    const env = Object.fromEntries(values.env.map((e) => [e.name, e]));
    for (const v of serverVars) {
      expect(env[v], `${v} is in the values' env`).toBeDefined();
      expect(env[v].value, `${v} has no literal value`).toBeUndefined();
      const ref = env[v].valueFrom.configMapKeyRef ?? env[v].valueFrom.secretKeyRef;
      expect(ref?.name, `${v} comes from a ConfigMap or Secret`).toMatch(/^sefaria-social-/);
    }
    for (const secret of ["DATABASE_URL", "USER_DELETED_WEBHOOK_SECRET", "RELAY_INTERNAL_SECRET"]) {
      expect(env[secret].valueFrom.secretKeyRef, `${secret} comes from the Secret`).toBeDefined();
      expect(values.configMap.data[secret]).toBeUndefined();
    }
  });
});
