#!/usr/bin/env node
// `node factory/preflight.mjs <lane>` (or `npm run factory -- preflight <lane>`): decides whether an agent lane runs.
// Plan 5.8: every agent job skips with a clear notice when its credentials are absent, and never fails the PR for that.
// Zero dependencies (only node builtins), so a workflow can run it before `npm ci`.
//
// Reads the environment a workflow step passes in (never the secret values themselves, only whether they are set):
//   HAS_ANTHROPIC_API_KEY        "true" when secrets.ANTHROPIC_API_KEY is set
//   ANTHROPIC_FEDERATION_RULE_ID, ANTHROPIC_ORGANIZATION_ID   repository variables for OIDC (workload identity federation)
//   HAS_HOLDOUT_DEPLOY_KEY, STAGING_URL                       holdout lane only
//   EVENT_NAME, HEAD_REPO, BASE_REPO, ACTOR                   from the github context
//   REVIEWER_MODEL, AGENT_MODEL                               repository variables (optional)
// Writes run, reason, auth and model to $GITHUB_OUTPUT, a ::notice:: line on a skip, and a line to $GITHUB_STEP_SUMMARY.
// Exit code is 0 for "run" and for "skip"; 2 only for a usage error (an unknown lane), which is a bug in the workflow.
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Rule ids; each has a negative test tagged `@guard preflight/<id>` (doctor checks). */
export const RULES = ["credentials", "forks", "bots", "security-key-only", "holdout-inputs"];

/** Opus-class by default (plan 5.8, decision D7: never downgrade the reviewer to save cost). */
export const DEFAULT_MODEL = "claude-opus-5-5";

export const LANES = {
  review: { title: "agent review", needsAgent: true },
  qa: { title: "agent QA", needsAgent: true },
  security: { title: "security review", needsAgent: true, apiKeyOnly: true },
  retro: { title: "weekly retro (agent part)", needsAgent: true, allowSchedule: true },
  holdout: { title: "holdout scenarios", needsAgent: true, needsHoldout: true, allowSchedule: true },
};

const CHECKLIST = "docs/runbooks/setup-checklist.md";

const isTrue = (v) => String(v ?? "").toLowerCase() === "true";
const has = (v) => String(v ?? "").trim() !== "";

/**
 * Pure decision. Returns { run: boolean, reason: string, auth: "api-key"|"oidc"|"none", model: string, rule?: string }.
 * @param {string} lane @param {Record<string,string|undefined>} env
 */
export function decide(lane, env) {
  const cfg = LANES[lane];
  if (!cfg) throw new Error(`unknown lane '${lane}' (known: ${Object.keys(LANES).join(", ")})`);
  const model = (lane === "review" ? env.REVIEWER_MODEL : env.AGENT_MODEL) || DEFAULT_MODEL;
  const apiKey = isTrue(env.HAS_ANTHROPIC_API_KEY);
  const oidc = has(env.ANTHROPIC_FEDERATION_RULE_ID) && has(env.ANTHROPIC_ORGANIZATION_ID);
  const auth = apiKey ? "api-key" : oidc ? "oidc" : "none";
  const skip = (rule, reason) => ({ run: false, reason, auth, model, rule });

  const prEvent = /^pull_request/.test(env.EVENT_NAME ?? "");
  if (prEvent && has(env.HEAD_REPO) && env.HEAD_REPO !== env.BASE_REPO)
    return skip(
      "forks",
      `${cfg.title} skipped: the pull request comes from a fork (${env.HEAD_REPO}). Agent lanes never run on forks: forks get no secrets, and the security review action is not hardened against prompt injection.`,
    );
  if (prEvent && /\[bot\]$/.test(env.ACTOR ?? ""))
    return skip(
      "bots",
      `${cfg.title} skipped: the actor ${env.ACTOR} is a bot. Bots do not start agent lanes (claude-code-action's allowed_bots is empty).`,
    );
  if (cfg.apiKeyOnly && !apiKey)
    return skip(
      oidc ? "security-key-only" : "credentials",
      oidc
        ? `${cfg.title} skipped: anthropics/claude-code-security-review accepts only an API key (claude-api-key), not OIDC federation. Add the repository secret ANTHROPIC_API_KEY (see ${CHECKLIST}).`
        : `${cfg.title} skipped: no Anthropic credential is configured. Add the repository secret ANTHROPIC_API_KEY (see ${CHECKLIST}, "Credentials and secrets").`,
    );
  if (cfg.needsAgent && auth === "none")
    return skip(
      "credentials",
      `${cfg.title} skipped: no Anthropic credential is configured. Add the repository secret ANTHROPIC_API_KEY, or the repository variables ANTHROPIC_FEDERATION_RULE_ID and ANTHROPIC_ORGANIZATION_ID for OIDC (see ${CHECKLIST}, "Credentials and secrets").`,
    );
  if (cfg.needsHoldout) {
    const missing = [];
    if (!isTrue(env.HAS_HOLDOUT_DEPLOY_KEY)) missing.push("the secret HOLDOUT_DEPLOY_KEY");
    if (!has(env.HOLDOUT_REPO)) missing.push("the variable HOLDOUT_REPO");
    if (!has(env.STAGING_URL)) missing.push("the variable STAGING_URL");
    if (missing.length)
      return skip(
        "holdout-inputs",
        `${cfg.title} skipped: ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} not configured (see ${CHECKLIST}, "Holdout scenarios").`,
      );
  }
  return { run: true, reason: `${cfg.title}: credentials present (${auth}); running with model ${model}`, auth, model };
}

export function runPreflight(_root, args, out, env = process.env) {
  const lane = args[0];
  if (!LANES[lane]) {
    out.err(`preflight: unknown lane '${lane ?? ""}'. Usage: preflight <${Object.keys(LANES).join("|")}>`);
    return 2;
  }
  const d = decide(lane, env);
  if (env.GITHUB_OUTPUT)
    appendFileSync(
      env.GITHUB_OUTPUT,
      `run=${d.run}\nauth=${d.auth}\nmodel=${d.model}\nreason=${d.reason.replace(/\n/g, " ")}\nrule=${d.rule ?? ""}\n`,
    );
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `- ${d.run ? "RUN" : "SKIP"}: ${d.reason}\n`);
  if (d.run) out.log(`preflight ${lane}: RUN (${d.reason})`);
  else out.log(`${env.GITHUB_ACTIONS === "true" ? "::notice title=agent lane skipped::" : "preflight: SKIP "}${d.reason}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = { log: (s) => console.log(s), err: (s) => console.error(s) };
  process.exitCode = runPreflight(null, process.argv.slice(2), out);
}
