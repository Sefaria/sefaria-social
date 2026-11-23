// `release check-dockerfile` (spec 021 AC-001): the server image's rules, checked on the Dockerfile's text.
//  - pinned-base: every FROM names an exact version tag and a sha256 digest (a stage alias is fine).
//  - no-fetch: nothing is fetched from a URL during the build (ADD <url>, curl, wget). Packages come from the lockfile.
//  - non-root: the final stage sets a USER that is not root (0).
//  - healthcheck: a HEALTHCHECK calls /api/v1/health.
export interface DockerProblem {
  line: number;
  rule: "pinned-base" | "no-fetch" | "non-root" | "healthcheck";
  message: string;
}

/** Joins continuation lines and drops comments, keeping each instruction's first line number. */
function instructions(text: string): { line: number; cmd: string; args: string }[] {
  const out: { line: number; cmd: string; args: string }[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const start = i;
    let body = lines[i]!;
    if (/^\s*(#|$)/.test(body)) continue;
    while (/\\\s*$/.test(body) && i + 1 < lines.length) {
      i++;
      const next = lines[i]!;
      body = body.replace(/\\\s*$/, " ") + (/^\s*#/.test(next) ? "" : next);
    }
    const m = body.trim().match(/^(\w+)\s*(.*)$/s);
    if (m) out.push({ line: start + 1, cmd: m[1]!.toUpperCase(), args: m[2]! });
  }
  return out;
}

export function checkDockerfile(text: string): DockerProblem[] {
  const problems: DockerProblem[] = [];
  const ins = instructions(text);
  const stages = new Set<string>();
  let finalUser: { line: number; user: string } | null = null;
  let health = false;
  for (const { line, cmd, args } of ins) {
    if (cmd === "FROM") {
      const parts = args.split(/\s+/).filter((p) => !p.startsWith("--"));
      const image = parts[0] ?? "";
      const alias = parts[1]?.toUpperCase() === "AS" ? parts[2] : undefined;
      if (!stages.has(image) && !/^[\w./-]+:[\w][\w.-]*@sha256:[0-9a-f]{64}$/.test(image))
        problems.push({
          line,
          rule: "pinned-base",
          message: `FROM ${image} is not pinned. Fix: name an exact version tag and its digest, e.g. node:22.22.0-bookworm-slim@sha256:<64 hex>.`,
        });
      if (/:latest@|:latest$/.test(image))
        problems.push({ line, rule: "pinned-base", message: `FROM ${image} uses "latest". Fix: name an exact version tag.` });
      if (alias) stages.add(alias);
      finalUser = null; // USER is per stage; only the final stage's counts
      health = false;
    }
    if (cmd === "ADD" && /https?:\/\//.test(args))
      problems.push({ line, rule: "no-fetch", message: "ADD fetches a URL. Fix: COPY files from the build context." });
    if (cmd === "RUN" && /\b(curl|wget)\b/.test(args))
      problems.push({
        line,
        rule: "no-fetch",
        message:
          "RUN fetches with curl or wget. Fix: install from the lockfile (npm ci) or COPY the file into the build context.",
      });
    if (cmd === "USER") finalUser = { line, user: args.trim() };
    if (cmd === "HEALTHCHECK" && /\/api\/v1\/health/.test(args)) health = true;
  }
  const lastLine = ins.at(-1)?.line ?? 1;
  if (!finalUser || /^(root|0)(:|$)/.test(finalUser.user))
    problems.push({
      line: finalUser?.line ?? lastLine,
      rule: "non-root",
      message: "the final stage runs as root. Fix: add USER node (or another non-root user) to the final stage.",
    });
  if (!health)
    problems.push({
      line: lastLine,
      rule: "healthcheck",
      message: "the final stage has no HEALTHCHECK on /api/v1/health. Fix: add a HEALTHCHECK that requests /api/v1/health.",
    });
  return problems;
}
