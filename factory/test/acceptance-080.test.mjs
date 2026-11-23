// Acceptance tests for spec 080 (agent lanes run capped and skip cleanly without credentials). They drive the factory CLI only,
// so they load on the merge base and fail there on an assertion (prove-red).
// @feature OPS-080 Agent lanes skip with a notice when credentials are absent
// @feature OPS-081 Agent jobs are capped, gated and hold no deploy credentials
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { REPO, cli, humanEnv, makeRepo, write } from "./helpers.mjs";

const PR = {
  EVENT_NAME: "pull_request",
  HEAD_REPO: "Sefaria/sefaria-social",
  BASE_REPO: "Sefaria/sefaria-social",
  ACTOR: "someone",
};
const outputFile = () => path.join(mkdtempSync(path.join(tmpdir(), "acc080-")), "out");
const AGENT_WORKFLOWS = ["agent-review.yml", "agent-qa.yml", "security-review.yml", "retro.yml", "nightly.yml"];

const AGENT_JOB = (o = {}) =>
  [
    "name: x",
    "on: pull_request",
    "permissions:",
    "  contents: read",
    "jobs:",
    "  preflight:",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 3",
    "    outputs:",
    "      run: ${{ steps.pre.outputs.run }}",
    "    steps:",
    "      - id: pre",
    "        run: node factory/preflight.mjs review",
    "  review:",
    "    needs: preflight",
    `    if: ${o.if ?? "needs.preflight.outputs.run == 'true'"}`,
    "    runs-on: ubuntu-latest",
    ...(o.noTimeout ? [] : ["    timeout-minutes: 20"]),
    "    steps:",
    "      - uses: anthropics/claude-code-action@acfe7992852970efb4fee683d63d628e3e52df67",
    "        with:",
    `          anthropic_api_key: \${{ secrets.${o.secret ?? "ANTHROPIC_API_KEY"} }}`,
    '          allow_fork_prs: "false"',
    "          prompt: review",
    `          claude_args: --model m ${o.noTurns ? "" : "--max-turns 5"} --allowedTools Read`,
    "",
  ].join("\n");

function fixture(workflow) {
  const root = makeRepo();
  mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
  cpSync(path.join(REPO, ".github/workflows/ci.yml"), path.join(root, ".github/workflows/ci.yml"));
  write(root, { ".github/workflows/x.yml": workflow });
  return root;
}

describe("spec 080: agent lanes", () => {
  // @ac 080/AC-001
  it("without any Anthropic credential, every agent lane skips with a notice naming the secret and the checklist, exit 0", () => {
    const lanes = ["review", "qa", "security", "retro"].map((lane) => {
      const out = outputFile();
      const r = cli(REPO, ["preflight", lane], humanEnv({ ...PR, GITHUB_ACTIONS: "true", GITHUB_OUTPUT: out }));
      return {
        lane,
        code: r.code,
        notice: /::notice title=agent lane skipped::.*ANTHROPIC_API_KEY.*docs\/runbooks\/setup-checklist\.md/.test(r.stdout),
        out: existsSync(out) ? readFileSync(out, "utf8").split("\n")[0] : "",
      };
    });
    expect(lanes).toEqual(
      ["review", "qa", "security", "retro"].map((lane) => ({ lane, code: 0, notice: true, out: "run=false" })),
    );
  });

  // @ac 080/AC-002
  it("a pull request from a fork never runs the security review, even with an API key", () => {
    const out = outputFile();
    const r = cli(
      REPO,
      ["preflight", "security"],
      humanEnv({ ...PR, HEAD_REPO: "stranger/fork", HAS_ANTHROPIC_API_KEY: "true", GITHUB_OUTPUT: out }),
    );
    expect(r.code).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("run=false\n");
    expect(readFileSync(out, "utf8")).toContain("rule=forks\n");
  });

  // @ac 080/AC-003
  it("with credentials the review runs on REVIEWER_MODEL, defaulting to an Opus-class model", () => {
    const a = outputFile();
    const b = outputFile();
    expect(cli(REPO, ["preflight", "review"], humanEnv({ ...PR, HAS_ANTHROPIC_API_KEY: "true", GITHUB_OUTPUT: a })).code).toBe(0);
    cli(
      REPO,
      ["preflight", "review"],
      humanEnv({ ...PR, HAS_ANTHROPIC_API_KEY: "true", REVIEWER_MODEL: "claude-opus-5", GITHUB_OUTPUT: b }),
    );
    expect(readFileSync(a, "utf8")).toMatch(/^run=true\nauth=api-key\nmodel=claude-opus-5-5\n/);
    expect(readFileSync(b, "utf8")).toContain("model=claude-opus-5\n");
  });

  // @ac 080/AC-004
  it("doctor refuses an agent job without a turn limit, a time limit or a preflight gate, or with a deploy secret", () => {
    const r = cli(fixture(AGENT_JOB({ noTurns: true, noTimeout: true, if: "always()", secret: "DEPLOY_KEY" })), [
      "doctor",
      "--skip-tests",
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("x [agent-jobs] .github/workflows/x.yml job 'review' runs an agent without timeout-minutes");
    expect(r.stderr).toContain("x [agent-jobs] .github/workflows/x.yml job 'review' is not gated on a preflight job");
    expect(r.stderr).toContain("x [agent-jobs] .github/workflows/x.yml job 'review' has no --max-turns in claude_args");
    expect(r.stderr).toContain("x [agent-jobs] .github/workflows/x.yml job 'review' reads secret(s) DEPLOY_KEY");
    expect(cli(REPO, ["doctor", "--skip-tests"]).stdout).toContain("ok agent-jobs");
  });

  // @ac 080/AC-005
  it("doctor refuses a workflow job with no time limit or an unpinned third-party action", () => {
    const wf =
      "name: y\non: push\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: someone/thing@v2\n";
    const r = cli(fixture(wf), ["doctor", "--skip-tests"]);
    expect(r.stderr).toContain("x [workflows] .github/workflows/x.yml job 'a' has no timeout-minutes");
    expect(r.stderr).toContain(
      "x [workflows] .github/workflows/x.yml job 'a' uses someone/thing@v2; pin third-party actions to a full commit SHA",
    );
    expect(cli(REPO, ["doctor", "--skip-tests"]).stdout).toContain("ok workflows");
  });

  // @ac 080/AC-006
  it("each agent workflow's own preflight step, run with no secrets set, skips and exits 0", () => {
    expect(AGENT_WORKFLOWS.filter((f) => !existsSync(path.join(REPO, ".github/workflows", f)))).toEqual([]);
    const results = AGENT_WORKFLOWS.flatMap((f) => {
      const wf = YAML.parse(readFileSync(path.join(REPO, ".github/workflows", f), "utf8"));
      return Object.values(wf.jobs).flatMap((j) =>
        (j.steps ?? [])
          .filter((s) => /node factory\/preflight\.mjs/.test(s.run ?? ""))
          .map((s) => {
            const lane = s.run.match(/preflight\.mjs (\w+)/)[1];
            const env = Object.fromEntries(
              Object.keys(s.env ?? {}).map((k) => [
                k,
                /^HAS_/.test(k) ? "false" : k === "EVENT_NAME" ? "pull_request" : /REPO$/.test(k) ? "Sefaria/sefaria-social" : "",
              ]),
            );
            const out = outputFile();
            const r = cli(REPO, ["preflight", lane], humanEnv({ ...env, GITHUB_OUTPUT: out }));
            return { f, lane, code: r.code, run: readFileSync(out, "utf8").split("\n")[0] };
          }),
      );
    });
    expect(results.map((r) => r.f).sort()).toEqual([...AGENT_WORKFLOWS].sort());
    expect(results.filter((r) => r.code !== 0 || r.run !== "run=false")).toEqual([]);
  });
});
