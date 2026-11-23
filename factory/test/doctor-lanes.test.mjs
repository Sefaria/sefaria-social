// Doctor rules added with the agent lanes (F2): agent jobs, workflow hygiene, the surface map, and reporter jobs after `result`.
// Each check has a fixture that breaks it (tagged @guard doctor/<check>), and the real repository passes.
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO, makeRepo, read, write } from "./helpers.mjs";
import { checkAgentJobs, checkResultNeeds, checkSurfaceMap, checkWorkflows } from "../doctor.mjs";

function copyOfRepo() {
  const root = makeRepo();
  for (const rel of [".github", "docs/features", "specs", "factory/surface-map.yaml", "factory/preflight.mjs"]) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    cpSync(path.join(REPO, rel), path.join(root, rel), { recursive: true });
  }
  return root;
}

const edit = (root, rel, from, to) => {
  const text = read(root, rel);
  expect(text).toContain(from);
  write(root, { [rel]: text.replace(from, to) });
};

describe("doctor: agent lanes", () => {
  it("the real repository passes the new checks", () => {
    expect([...checkAgentJobs(REPO), ...checkWorkflows(REPO), ...checkSurfaceMap(REPO), ...checkResultNeeds(REPO)]).toEqual([]);
  });

  // @guard doctor/agent-jobs
  it("fails an agent job with no turn limit, no timeout, no fork refusal or an extra secret", () => {
    const root = copyOfRepo();
    const wf = ".github/workflows/agent-review.yml";
    edit(root, wf, "--max-turns 40", "");
    edit(root, wf, "    timeout-minutes: 20\n", "");
    edit(root, wf, 'allow_fork_prs: "false"', 'allow_fork_prs: "true"');
    edit(root, wf, "github_token: ${{ secrets.GITHUB_TOKEN }}", "github_token: ${{ secrets.DEPLOY_TOKEN }}");
    expect(checkAgentJobs(root)).toEqual([
      ".github/workflows/agent-review.yml job 'review' runs an agent without timeout-minutes",
      ".github/workflows/agent-review.yml job 'review' has no --max-turns in claude_args",
      ".github/workflows/agent-review.yml job 'review' must set allow_fork_prs: \"false\"",
      ".github/workflows/agent-review.yml job 'review' reads secret(s) DEPLOY_TOKEN; agent jobs get only ANTHROPIC_API_KEY, GITHUB_TOKEN",
    ]);
  });

  // @guard doctor/agent-jobs
  it("fails an agent job that is not gated on the preflight (it would fail instead of skipping without credentials)", () => {
    const root = copyOfRepo();
    edit(root, ".github/workflows/agent-qa.yml", "if: needs.preflight.outputs.run == 'true'\n    runs-on", "runs-on");
    expect(checkAgentJobs(root)).toEqual([
      ".github/workflows/agent-qa.yml job 'qa' is not gated on a preflight job (needs: <job running factory/preflight.mjs>, if: needs.<job>.outputs.run == 'true'), so it would fail instead of skipping when credentials are absent",
    ]);
  });

  // @guard doctor/agent-jobs
  it("fails the security review when it does not refuse forks or is not pinned", () => {
    const root = copyOfRepo();
    const wf = ".github/workflows/security-review.yml";
    edit(
      root,
      wf,
      "if: needs.preflight.outputs.run == 'true' && github.event.pull_request.head.repo.full_name == github.repository\n    runs-on",
      "if: needs.preflight.outputs.run == 'true'\n    runs-on",
    );
    edit(root, wf, "claude-code-security-review@0c6a49f1fa56a1d472575da86a94dbc1edb78eda", "claude-code-security-review@main");
    expect(checkAgentJobs(root)).toEqual([
      ".github/workflows/security-review.yml job 'security' uses anthropics/claude-code-security-review@main; pin agent actions to a full commit SHA",
      ".github/workflows/security-review.yml job 'security' must refuse forks in its if: (github.event.pull_request.head.repo.full_name == github.repository)",
    ]);
  });

  // @guard doctor/workflows
  it("fails a job with no time limit, an unknown need, an unpinned third-party action, or the holdout key outside nightly", () => {
    const root = copyOfRepo();
    write(root, {
      ".github/workflows/rogue.yml": [
        "name: rogue",
        "on: push",
        "permissions:",
        "  contents: read",
        "jobs:",
        "  a:",
        "    runs-on: ubuntu-latest",
        "    needs: ghost",
        "    steps:",
        "      - uses: someone/action@v1",
        "      - run: echo ${{ secrets.HOLDOUT_DEPLOY_KEY }}",
        "",
      ].join("\n"),
    });
    expect(checkWorkflows(root)).toEqual([
      ".github/workflows/rogue.yml job 'a' has no timeout-minutes",
      ".github/workflows/rogue.yml job 'a' needs 'ghost', which is not a job here",
      ".github/workflows/rogue.yml job 'a' uses someone/action@v1; pin third-party actions to a full commit SHA",
      ".github/workflows/rogue.yml job 'a' reads HOLDOUT_DEPLOY_KEY; only .github/workflows/nightly.yml and .github/workflows/release.yml may check out the holdout repository",
    ]);
  });

  // @guard doctor/surface-map
  it("fails when a spec or an atlas entry names a surface that is not in the map", () => {
    const root = copyOfRepo();
    edit(root, "specs/000-hello-surface/spec.md", "surfaces: [feed]", "surfaces: [feeed]");
    // Break the first atlas entry whose first surface is "feed" (the area field also says "feed"; leave it alone).
    const atlas = JSON.parse(read(root, "docs/features/features.json"));
    const firstFeed = atlas.features.find((f) => f.surfaces[0] === "feed").id;
    edit(root, "docs/features/features.json", '"surfaces": [\n        "feed"', '"surfaces": [\n        "lobby-x"');
    expect(checkSurfaceMap(root)).toEqual([
      "spec 000 names surface 'feeed', which is not in factory/surface-map.yaml",
      `atlas entry ${firstFeed} names surface 'lobby-x', which is not in factory/surface-map.yaml`,
    ]);
  });

  // @guard doctor/result-needs
  it("allows a reporter job that needs result (it runs after it), and still catches a job that is in neither", () => {
    const root = copyOfRepo();
    expect(checkResultNeeds(root)).toEqual([]);
    edit(
      root,
      ".github/workflows/ci.yml",
      "needs: [changes, static, unit, build, spec-gate, prove-red, result]",
      "needs: [changes]",
    );
    expect(checkResultNeeds(root)).toEqual([
      "ci.yml job 'metrics' is not in result.needs, so its failure would not block a merge",
    ]);
  });
});
