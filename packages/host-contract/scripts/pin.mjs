// Pins the reader's SurfaceHost contract into packages/host-contract/pinned/ and checks the pin (L3, plan 5.5).
//
//   node scripts/pin.mjs <reader repo checkout> <commit>   copy the contract files at <commit> and record their hashes
//   node scripts/pin.mjs --check [--dir <package dir>]     fail if a pinned file differs from the hash recorded at pin time
//
// The pinned files are never edited by hand (they are a protected path). A change to the contract is a new pin from a reader
// commit, reviewed by a human; `--check` runs in CI so a hand edit, or a file swapped without a new SOURCE.json, turns it red.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FILES = ["surface-host.v1.ts", "surface-manifest.v1.ts", "surface-manifest.v1.schema.json"];
const READER_DIR = "reader-next/contract";
const sha256 = (buf) => `sha256:${createHash("sha256").update(buf).digest("hex")}`;

/**
 * The hash of the whole pinned folder, as `factory doctor` computes it (factory/doctor.mjs checkPinnedContract): every file
 * except contract.sha256, sorted by name, as "<name>\0<text>\0".
 */
export function folderHash(pinned) {
  const h = createHash("sha256");
  for (const name of readdirSync(pinned)
    .filter((n) => n !== "contract.sha256" && !n.startsWith("."))
    .sort())
    h.update(`${name}\0`)
      .update(readFileSync(path.join(pinned, name), "utf8"))
      .update("\0");
  return `sha256:${h.digest("hex")}`;
}

export function check(pkgDir) {
  const pinned = path.join(pkgDir, "pinned");
  let source;
  try {
    source = JSON.parse(readFileSync(path.join(pinned, "SOURCE.json"), "utf8"));
  } catch (e) {
    return [`pinned/SOURCE.json is missing or not JSON (${e.message}). Fix: re-pin with scripts/pin.mjs.`];
  }
  const problems = [];
  for (const f of FILES) {
    let actual;
    try {
      actual = sha256(readFileSync(path.join(pinned, f)));
    } catch {
      problems.push(`pinned/${f} is missing. Fix: re-pin with scripts/pin.mjs <reader checkout> <commit>.`);
      continue;
    }
    if (source.files?.[f] !== actual)
      problems.push(
        `pinned/${f} does not match the hash recorded when it was pinned from ${source.repo}@${source.commit} (recorded ${source.files?.[f]}, actual ${actual}). The pinned contract is never edited by hand. Fix: revert the edit, or re-pin from a reader commit with scripts/pin.mjs and have a human review the contract change.`,
      );
  }
  let recorded = "";
  try {
    recorded = readFileSync(path.join(pinned, "contract.sha256"), "utf8").trim();
  } catch {
    recorded = "";
  }
  const actual = folderHash(pinned);
  if (recorded !== actual)
    problems.push(
      `pinned/contract.sha256 is ${recorded || "missing"} but the pinned folder hashes to ${actual}. Fix: re-pin with scripts/pin.mjs; never edit pinned files by hand.`,
    );
  return problems;
}

function pin(pkgDir, checkout, commit) {
  const full = execFileSync("git", ["-C", checkout, "rev-parse", commit], { encoding: "utf8" }).trim();
  const files = {};
  for (const f of FILES) {
    const buf = execFileSync("git", ["-C", checkout, "show", `${full}:${READER_DIR}/${f}`]);
    writeFileSync(path.join(pkgDir, "pinned", f), buf);
    files[f] = sha256(buf);
  }
  const source = { repo: "Sefaria/Sefaria-Project", path: READER_DIR, commit: full, pinnedAt: new Date().toISOString(), files };
  writeFileSync(path.join(pkgDir, "pinned", "SOURCE.json"), `${JSON.stringify(source, null, 2)}\n`);
  writeFileSync(path.join(pkgDir, "pinned", "contract.sha256"), `${folderHash(path.join(pkgDir, "pinned"))}\n`);
  return source;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const dirAt = args.indexOf("--dir");
  const pkgDir = dirAt >= 0 ? path.resolve(args[dirAt + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (args.includes("--check")) {
    const problems = check(pkgDir);
    if (problems.length) {
      console.error(`pinned contract: FAIL\n${problems.map((p) => `  x ${p}`).join("\n")}`);
      process.exit(1);
    }
    console.log("pinned contract: PASS (every pinned file matches pinned/SOURCE.json)");
  } else if (args.length >= 2) {
    const s = pin(pkgDir, args[0], args[1]);
    console.log(`pinned ${FILES.length} files from ${s.repo}@${s.commit}`);
  } else {
    console.error("usage: pin.mjs <reader checkout> <commit> | pin.mjs --check [--dir <package dir>]");
    process.exit(2);
  }
}
