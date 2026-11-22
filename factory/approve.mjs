// `npm run factory -- approve NNN --by <email>`: record a human code owner's agreement to a spec (plan 5.2).
// Run by that human, after their approving review of the spec PR, from their own terminal. It writes
// specs/approvals.json { "<id>": { by, sha, at } } and sets the spec's status to `approved`.
// It refuses an empty email, a bot/agent/CI identity, and any run from inside an agent session or CI.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { FactoryError, readText } from "./lib/repo.mjs";
import { APPROVALS, NON_HUMAN_EMAIL, loadApprovals, loadSpec } from "./lib/spec.mjs";

export const RULES = ["human-email", "not-agent-session", "spec-valid"];

/** Environment variables that mean "an agent or CI is running this", not a person at a terminal. */
const AGENT_ENV = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_REMOTE", "GITHUB_ACTIONS", "CI"];

export function runApprove(root, args, out, env = process.env) {
  const id = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--by");
  const byIdx = args.indexOf("--by");
  const by = byIdx >= 0 ? (args[byIdx + 1] ?? "").trim() : "";
  if (!id) throw new FactoryError("approve needs a spec id", "npm run factory -- approve NNN --by <your email>");
  if (!by || by.startsWith("--"))
    throw new FactoryError(
      "approve needs --by <email> naming the human who reviewed the spec",
      "npm run factory -- approve NNN --by <your email>",
    );
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(by)) throw new FactoryError(`'${by}' is not an email address`, "Pass your own email.");
  if (NON_HUMAN_EMAIL.test(by))
    throw new FactoryError(
      `'${by}' looks like a bot, agent or CI identity; only a human code owner can agree to a spec`,
      "A human owner runs this with their own email.",
    );
  const agentVar = AGENT_ENV.find((k) => env[k] && env[k] !== "false" && env[k] !== "0");
  if (agentVar)
    throw new FactoryError(
      `refusing to approve from an agent session or CI (${agentVar} is set). Approval is a human act.`,
      "The human code owner runs this command in their own terminal after reviewing the spec PR.",
    );

  const spec = loadSpec(root, id);
  if (spec.problems.length)
    throw new FactoryError(`spec ${spec.id} is not valid:\n  ${spec.problems.join("\n  ")}`, "Fix the spec before approving it.");
  const { data, problems } = loadApprovals(root);
  if (problems.length) throw new FactoryError(`${APPROVALS} is not valid:\n  ${problems.join("\n  ")}`, "Fix it by hand.");

  const at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const next = { ...data, [spec.id]: { by, sha: spec.sha, at } };
  const sorted = Object.fromEntries(
    Object.keys(next)
      .sort()
      .map((k) => [k, next[k]]),
  );
  writeFileSync(path.join(root, APPROVALS), `${JSON.stringify(sorted, null, 2)}\n`);

  // status is outside the content hash, so updating it does not invalidate the approval just written.
  const specText = readText(root, spec.specRel);
  const updated = specText.replace(/^status:\s*(proposed|draft)\s*$/m, "status: approved");
  if (updated !== specText) writeFileSync(path.join(root, spec.specRel), updated);

  out.log(`approve ${spec.id}: recorded ${by} for ${spec.sha.slice(0, 19)}… in ${APPROVALS}`);
  out.log(`  next: npm run factory -- compile ${spec.id}   (recompiles the work order as approved), then commit both files.`);
  return 0;
}
