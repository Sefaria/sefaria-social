// `npm run api:breaking -- --base <ref>`: fail when the PR's OpenAPI document breaks older clients (spec 007 AC-007).
// Compares packages/api-client/openapi.json at the merge base with the working tree. Breaking changes pass only when a spec
// changed in the PR declares `contract_impact: api-major` (a human agreed to the break).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { breakingChanges, verdict } from "../src/server/api/breaking";

const DOC = "packages/api-client/openapi.json";
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const tryGit = (...args: string[]) => {
  try {
    return git(...args);
  } catch {
    return null;
  }
};

const i = process.argv.indexOf("--base");
const base = i >= 0 ? process.argv[i + 1] : process.env.FACTORY_BASE;
if (!base) {
  console.error("api-breaking: give --base <ref> (the PR's base commit)");
  process.exit(2);
}
const mergeBase = git("merge-base", base, "HEAD").trim();
const baseText = tryGit("show", `${mergeBase}:${DOC}`);
if (baseText === null) {
  console.log(
    `api-breaking: PASS with notice: ${DOC} does not exist at the merge base ${mergeBase.slice(0, 10)}; nothing to compare.`,
  );
  process.exit(0);
}
const changes = breakingChanges(JSON.parse(baseText), JSON.parse(readFileSync(DOC, "utf8")));
const changedSpecs = git("diff", "--name-only", `${mergeBase}...HEAD`, "--", "specs")
  .split("\n")
  .filter((f) => /^specs\/\d{3}-[^/]+\/spec\.md$/.test(f))
  .map((f) => {
    const text = tryGit("show", `HEAD:${f}`) ?? "";
    return { id: f.slice(6, 9), contractImpact: /^contract_impact:\s*(\S+)/m.exec(text)?.[1] ?? null };
  });
const v = verdict(changes, changedSpecs);
(v.ok ? console.log : console.error)(v.lines.join("\n"));
process.exit(v.ok ? 0 : 1);
