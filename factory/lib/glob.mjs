// A small, dependency-free glob matcher (repo-relative POSIX paths). The guard hook imports it, so it must work before
// `npm ci` has run. Supports `**` (any number of path segments), `*` and `?` (within one segment), `{a,b}` alternation and
// `[...]` classes. A pattern ending in `/` matches everything beneath that directory.

const cache = new Map();

function escape(ch) {
  return /[.+^$()|\\]/.test(ch) ? `\\${ch}` : ch;
}

/** Convert a glob to an anchored regular expression. */
export function globToRegExp(glob) {
  let g = glob.replace(/^\.\//, "");
  if (g.endsWith("/")) g += "**";
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === "*") {
      if (g[i + 1] === "*") {
        const atStart = i === 0 || g[i - 1] === "/";
        const atEnd = i + 2 === g.length || g[i + 2] === "/";
        if (atStart && atEnd) {
          // `**/` matches zero or more whole segments; a trailing `**` matches the rest of the path.
          if (i + 2 === g.length) re += ".*";
          else {
            re += "(?:.*/)?";
            i += 1; // skip the slash after **
          }
          i += 1;
          continue;
        }
        re += "[^/]*";
        i += 1;
        continue;
      }
      re += "[^/]*";
    } else if (ch === "?") re += "[^/]";
    else if (ch === "{") {
      const end = g.indexOf("}", i);
      if (end === -1) re += "\\{";
      else {
        const alts = g.slice(i + 1, end).split(",");
        re += `(?:${alts.map((a) => globToRegExp(a).source.slice(1, -1)).join("|")})`;
        i = end;
      }
    } else if (ch === "[") {
      const end = g.indexOf("]", i);
      if (end === -1) re += "\\[";
      else {
        re += g.slice(i, end + 1).replace(/^\[!/, "[^");
        i = end;
      }
    } else re += escape(ch);
  }
  return new RegExp(`^${re}$`);
}

/** True when the repo-relative path matches the glob. */
export function matchGlob(glob, file) {
  let re = cache.get(glob);
  if (!re) {
    re = globToRegExp(glob);
    cache.set(glob, re);
  }
  return re.test(file.replace(/\\/g, "/").replace(/^\.\//, ""));
}

export function matchAny(globs, file) {
  return globs.some((g) => matchGlob(g, file));
}

/** The literal directory prefix of a glob, before its first wildcard segment ("app/src/lib/*.ts" -> "app/src/lib"). */
export function globBase(glob) {
  const parts = glob.split("/");
  const lit = [];
  for (const p of parts) {
    if (/[*?{[]/.test(p)) break;
    lit.push(p);
  }
  if (lit.length === parts.length) lit.pop(); // a plain file path: its base is its directory
  return lit.join("/");
}

/** Problems with a task glob, or [] when it is acceptable. */
export function globProblems(glob) {
  const problems = [];
  if (typeof glob !== "string" || glob.trim() === "") return ["is empty"];
  if (glob.startsWith("/")) problems.push("is absolute (globs are repo-relative)");
  if (glob.split("/").includes("..")) problems.push("climbs out of the repo with '..'");
  if (glob.includes("\\")) problems.push("uses a backslash (use '/')");
  if (/^(\*\*?(\/\*\*?)*)(\/\*[^/]*)?$/.test(glob)) problems.push("matches the whole repo; name the files the task touches");
  if (globBase(glob) === "" && glob.includes("**")) problems.push("starts with '**'; anchor it under a directory");
  return problems;
}
