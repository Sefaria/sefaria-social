// Agent-lane preflight (plan 5.8): every agent job skips with a notice when its credentials are absent. Tagged @guard preflight/<rule>.
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { REPO, cli, humanEnv } from "./helpers.mjs";
import { DEFAULT_MODEL, LANES, decide } from "../preflight.mjs";

const PR = {
  EVENT_NAME: "pull_request",
  HEAD_REPO: "Sefaria/sefaria-social",
  BASE_REPO: "Sefaria/sefaria-social",
  ACTOR: "someone",
};

describe("preflight", () => {
  // @guard preflight/credentials
  it("skips every agent lane when neither an API key nor OIDC ids are configured", () => {
    for (const lane of Object.keys(LANES)) {
      const d = decide(lane, {
        ...PR,
        HAS_ANTHROPIC_API_KEY: "false",
        HAS_HOLDOUT_DEPLOY_KEY: "true",
        HOLDOUT_REPO: "x/y",
        STAGING_URL: "https://s",
      });
      expect({ lane, run: d.run, rule: d.rule }).toEqual({ lane, run: false, rule: "credentials" });
      expect(d.reason).toContain("docs/runbooks/setup-checklist.md");
    }
  });

  it("runs with an API key, or with OIDC federation ids, and reports which", () => {
    expect(decide("review", { ...PR, HAS_ANTHROPIC_API_KEY: "true" })).toMatchObject({ run: true, auth: "api-key" });
    expect(
      decide("qa", {
        ...PR,
        ANTHROPIC_FEDERATION_RULE_ID: "fdrl_x",
        ANTHROPIC_ORGANIZATION_ID: "00000000-0000-0000-0000-000000000000",
      }),
    ).toMatchObject({ run: true, auth: "oidc" });
    expect(decide("qa", { ...PR, ANTHROPIC_FEDERATION_RULE_ID: "fdrl_x" })).toMatchObject({ run: false, rule: "credentials" });
  });

  it("uses REVIEWER_MODEL for the review lane, and an Opus-class default", () => {
    expect(decide("review", { ...PR, HAS_ANTHROPIC_API_KEY: "true" }).model).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toMatch(/^claude-opus-/);
    expect(decide("review", { ...PR, HAS_ANTHROPIC_API_KEY: "true", REVIEWER_MODEL: "claude-x" }).model).toBe("claude-x");
    expect(decide("qa", { ...PR, HAS_ANTHROPIC_API_KEY: "true", REVIEWER_MODEL: "claude-x" }).model).toBe(DEFAULT_MODEL);
  });

  // @guard preflight/forks
  it("skips on a pull request from a fork, whatever the credentials", () => {
    const d = decide("security", { ...PR, HEAD_REPO: "stranger/sefaria-social", HAS_ANTHROPIC_API_KEY: "true" });
    expect(d).toMatchObject({ run: false, rule: "forks" });
    expect(d.reason).toContain("not hardened against prompt injection");
    expect(decide("review", { ...PR, HEAD_REPO: "stranger/sefaria-social", HAS_ANTHROPIC_API_KEY: "true" }).run).toBe(false);
  });

  // @guard preflight/bots
  it("skips when a bot opened or pushed the pull request", () => {
    expect(decide("review", { ...PR, ACTOR: "dependabot[bot]", HAS_ANTHROPIC_API_KEY: "true" })).toMatchObject({
      run: false,
      rule: "bots",
    });
  });

  // @guard preflight/security-key-only
  it("skips the security review with OIDC alone (the action takes only an API key)", () => {
    const d = decide("security", { ...PR, ANTHROPIC_FEDERATION_RULE_ID: "fdrl_x", ANTHROPIC_ORGANIZATION_ID: "org" });
    expect(d).toMatchObject({ run: false, rule: "security-key-only" });
  });

  // @guard preflight/holdout-inputs
  it("skips holdout scenarios until the deploy key, the repo name and a staging URL exist", () => {
    const d = decide("holdout", { EVENT_NAME: "schedule", HAS_ANTHROPIC_API_KEY: "true" });
    expect(d).toMatchObject({ run: false, rule: "holdout-inputs" });
    expect(d.reason).toContain(
      "the secret HOLDOUT_DEPLOY_KEY, the variable HOLDOUT_REPO, the variable STAGING_URL are not configured",
    );
    expect(
      decide("holdout", {
        EVENT_NAME: "schedule",
        HAS_ANTHROPIC_API_KEY: "true",
        HAS_HOLDOUT_DEPLOY_KEY: "true",
        HOLDOUT_REPO: "o/r",
        STAGING_URL: "https://s",
      }).run,
    ).toBe(true);
  });

  it("writes run/reason/auth/model to GITHUB_OUTPUT and a notice line, exit 0; exit 2 for an unknown lane", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "preflight-"));
    const output = path.join(dir, "out");
    const r = cli(REPO, ["preflight", "review"], humanEnv({ ...PR, GITHUB_ACTIONS: "true", GITHUB_OUTPUT: output }));
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^::notice title=agent lane skipped::agent review skipped: no Anthropic credential/m);
    const out = readFileSync(output, "utf8");
    expect(out).toContain("run=false\n");
    expect(out).toContain("rule=credentials\n");
    expect(cli(REPO, ["preflight", "nope"]).code).toBe(2);
  });
});

/** The env block of each workflow's preflight step, with every secret and variable absent (tonight's repository). */
function preflightSteps() {
  const dir = path.join(REPO, ".github/workflows");
  const found = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
    const wf = YAML.parse(readFileSync(path.join(dir, f), "utf8"));
    for (const [key, job] of Object.entries(wf.jobs ?? {}))
      for (const s of job.steps ?? []) {
        const m = String(s.run ?? "").match(/node factory\/preflight\.mjs (\w+)/);
        if (m) found.push({ file: f, job: key, lane: m[1], env: s.env ?? {}, wf });
      }
  }
  return found;
}

/** Evaluate a step's env the way Actions would with no secrets and no variables set. */
function envWithoutSecrets(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    const s = String(v);
    if (/secrets\.[A-Z_]+ != ''/.test(s)) out[k] = "false";
    else if (/\$\{\{\s*(secrets|vars)\./.test(s)) out[k] = "";
    else if (s.includes("github.event_name")) out[k] = "pull_request";
    else if (s.includes("head.repo.full_name") || s.includes("github.repository")) out[k] = "Sefaria/sefaria-social";
    else if (s.includes("github.actor")) out[k] = "someone";
    else out[k] = s;
  }
  return out;
}

describe("every agent workflow skips cleanly without secrets", () => {
  const steps = preflightSteps();

  it("finds a preflight step in each agent workflow", () => {
    expect([...new Set(steps.map((s) => s.file))].sort()).toEqual([
      "agent-qa.yml",
      "agent-review.yml",
      "nightly.yml",
      "retro.yml",
      "security-review.yml",
    ]);
  });

  it("each preflight, run with its own env block and no secrets, says skip and exits 0", () => {
    for (const s of steps) {
      const dir = mkdtempSync(path.join(tmpdir(), "skip-"));
      const output = path.join(dir, "out");
      const r = cli(
        REPO,
        ["preflight", s.lane],
        humanEnv({ ...envWithoutSecrets(s.env), GITHUB_ACTIONS: "true", GITHUB_OUTPUT: output }),
      );
      expect({ file: s.file, code: r.code }).toEqual({ file: s.file, code: 0 });
      expect(r.stdout).toContain("::notice title=agent lane skipped::");
      expect(readFileSync(output, "utf8")).toContain("run=false");
    }
  });

  it("every job that runs an agent action is gated on that preflight's run output", () => {
    for (const s of steps) {
      const gated = Object.entries(s.wf.jobs).filter(([, j]) => [].concat(j.needs ?? []).includes(s.job));
      const agentJobs = gated.filter(([, j]) => JSON.stringify(j.steps ?? []).includes("anthropics/claude-code"));
      for (const [key, j] of agentJobs)
        expect({ file: s.file, key, if: j.if }).toEqual({
          file: s.file,
          key,
          if: expect.stringMatching(new RegExp(`needs\\.${s.job}\\.outputs\\.run == 'true'`)),
        });
    }
  });
});
