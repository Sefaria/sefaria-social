// Repository access for the factory commands: read files at HEAD (the working tree) or at a git ref, list changes between a
// base and a head, and read commit trailers. Read-only: nothing here writes to git.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export class FactoryError extends Error {
  /** @param {string} message @param {string} [fix] */
  constructor(message, fix) {
    super(message);
    this.fix = fix;
  }
}

export function git(root, args, opts = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
}

export function tryGit(root, args) {
  try {
    return git(root, args, { stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/** The repository root: `--root` if given, else the git top level of the cwd, else the cwd. */
export function findRoot(explicit) {
  if (explicit) return path.resolve(explicit);
  const top = tryGit(process.cwd(), ["rev-parse", "--show-toplevel"]);
  return top ? top.trim() : process.cwd();
}

export function readText(root, rel) {
  const full = path.join(root, rel);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

export function readJson(root, rel, fallback = null) {
  const text = readText(root, rel);
  if (text === null) return fallback;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new FactoryError(`${rel} is not valid JSON: ${e.message}`, `Fix the JSON syntax in ${rel}.`);
  }
}

/** File content at a git ref, or null when it does not exist there. */
export function readAtRef(root, ref, rel) {
  return tryGit(root, ["show", `${ref}:${rel}`]);
}

export function resolveRef(root, ref) {
  const sha = tryGit(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (!sha) throw new FactoryError(`git ref '${ref}' does not exist`, `Fetch it (git fetch origin) or pass --base <ref>.`);
  return sha.trim();
}

export function mergeBase(root, base, head) {
  const mb = tryGit(root, ["merge-base", base, head]);
  if (!mb) throw new FactoryError(`no merge base between ${base} and ${head}`, "Fetch full history (fetch-depth: 0).");
  return mb.trim();
}

/**
 * Changes from the merge base of base and head to head: [{ status, path, oldPath?, added, deleted }].
 * Binary files count as 0 lines.
 */
export function changedFiles(root, base, head) {
  const range = `${base}...${head}`;
  const files = new Map();
  for (const line of git(root, ["diff", "--name-status", "-M", range]).split("\n").filter(Boolean)) {
    const [status, a, b] = line.split("\t");
    const entry = { status: status[0], path: b ?? a, oldPath: b ? a : undefined, added: 0, deleted: 0 };
    files.set(entry.path, entry);
  }
  for (const line of git(root, ["diff", "--numstat", "-M", range]).split("\n").filter(Boolean)) {
    const [add, del, ...rest] = line.split("\t");
    let p = rest.join("\t");
    const m = p.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
    if (m) p = `${m[1]}${m[3]}${m[4]}`.replace(/\/\//g, "/");
    else if (p.includes(" => ")) p = p.split(" => ")[1];
    const entry = files.get(p);
    if (entry) {
      entry.added = add === "-" ? 0 : Number(add);
      entry.deleted = del === "-" ? 0 : Number(del);
    }
  }
  return [...files.values()];
}

/** Trailers of every commit in base..head, as [{ key, value, commit }]. */
export function trailers(root, base, head) {
  const out = git(root, ["log", "--format=%H%x1f%(trailers:unfold,only)%x1e", `${base}..${head}`]);
  const result = [];
  for (const record of out.split("\x1e")) {
    const [commit, block] = record.split("\x1f");
    if (!block) continue;
    for (const line of block.split("\n")) {
      const m = line.match(/^([A-Za-z-]+):\s*(.+?)\s*$/);
      if (m) result.push({ key: m[1], value: m[2], commit: commit.trim() });
    }
  }
  return result;
}

/** All files under `dir` (repo-relative POSIX paths), skipping node_modules and dot-directories except the ones named. */
export function walk(root, dir = "", keepDot = [".claude", ".github"]) {
  const out = [];
  const start = path.join(root, dir);
  if (!existsSync(start)) return out;
  const stack = [dir];
  while (stack.length) {
    const rel = stack.pop();
    for (const name of readdirSync(path.join(root, rel))) {
      if (name === "node_modules" || name === ".git") continue;
      if (name.startsWith(".") && !keepDot.includes(name)) continue;
      const childRel = rel ? `${rel}/${name}` : name;
      const st = statSync(path.join(root, childRel));
      if (st.isDirectory()) stack.push(childRel);
      else out.push(childRel);
    }
  }
  return out.sort();
}
