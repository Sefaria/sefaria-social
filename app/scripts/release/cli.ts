// The release CLI (specs 019–021): `npm run release -- <command>`, or `scripts/rollback` for a rollback.
//
//   budget [--dir app/dist-surface] [--budget app/surface-budget.json]   size budget of a surface build (spec 019)
//   version                                   a release version from the CI run (or the clock, locally)
//   publish [--dir app/dist-surface] [--version <v>]                      upload a build under v/<version>/ (spec 020)
//   promote <version>                         smoke-test a published version and move the stable pointer to it
//   rollback [<version>]                      move the pointer back to the last known-good (or a named known-good) version
//   status                                    the pointer's current, known-good and rolled-back versions
//   smoke --version <v> | --url <manifest URL> [--origin <reader origin>] | --server <API origin>
//   serve --dir <folder> [--port 3410]        serve a filesystem target over HTTP with CORS (local rehearsal, e2e)
//   check-dockerfile [Dockerfile]             the server image's rules (spec 021)
//
// The storage target comes from --target or RELEASE_TARGET: file:<folder>, or bucket:<name> (a stub until the hosting exists).
// Exit codes: 0 done, 1 refused or failed (the message says why and how to fix it), 2 bad usage or configuration.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkBudget } from "./budget";
import { checkDockerfile } from "./dockerfile";
import { promote, readState, rollback } from "./pointer";
import { publish } from "./publish";
import { createReleaseServer } from "./serve";
import { smokeServer, smokeUrl, smokeVersion } from "./smoke";
import { targetFromSpec, type StorageTarget } from "./storage";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const APP = path.join(ROOT, "app");

class Usage extends Error {}

function parse(argv: string[]) {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) flags[k] = argv[++i]!;
      else flags[k] = "true";
    } else rest.push(a);
  }
  return { flags, rest };
}

function target(flags: Record<string, string>): StorageTarget {
  try {
    return targetFromSpec(flags.target ?? process.env.RELEASE_TARGET);
  } catch (e) {
    throw new Usage((e as Error).message);
  }
}

/** A version from the CI run: <UTC date>-<run number>.<short sha>; locally <UTC date and time>-local. */
export function releaseVersion(env = process.env, now = new Date()): string {
  const day = now.toISOString().slice(0, 10).replaceAll("-", ".");
  if (env.GITHUB_RUN_NUMBER && env.GITHUB_SHA)
    return `${day}-${env.GITHUB_RUN_NUMBER}${env.GITHUB_RUN_ATTEMPT && env.GITHUB_RUN_ATTEMPT !== "1" ? `.${env.GITHUB_RUN_ATTEMPT}` : ""}.${env.GITHUB_SHA.slice(0, 7)}`;
  return `${day}-${now.toISOString().slice(11, 19).replaceAll(":", "")}-local`;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  const { flags, rest } = parse(args);
  const out = (s: string) => console.log(s);
  switch (cmd) {
    case "budget": {
      const dir = path.resolve(flags.dir ?? path.join(APP, "dist-surface"));
      const r = await checkBudget(dir, path.resolve(flags.budget ?? path.join(APP, "surface-budget.json")));
      out(r.report);
      if (!r.ok) {
        for (const f of r.failures) console.error(`x ${f}`);
        return 1;
      }
      out("surface:budget: PASS");
      return 0;
    }
    case "version":
      out(releaseVersion());
      return 0;
    case "publish": {
      const t = target(flags);
      const r = await publish(t, path.resolve(flags.dir ?? path.join(APP, "dist-surface")), { version: flags.version });
      out(`published ${r.version} to ${t.describe()}: ${r.uploaded.length} uploaded, ${r.unchanged.length} already there`);
      for (const k of r.uploaded) out(`  + ${k}`);
      return 0;
    }
    case "promote": {
      const version = rest[0] ?? flags.version;
      if (!version) throw new Usage("promote needs a version: release promote <version>");
      const s = await promote(target(flags), version);
      out(`stable -> ${s.current} (last known-good: ${s.knownGood[0] ?? "none"})`);
      return 0;
    }
    case "rollback": {
      const s = await rollback(target(flags), rest[0] ?? flags.to);
      out(`rolled back: stable -> ${s.current} (rolled back: ${s.rolledBack.at(-1)})`);
      return 0;
    }
    case "status": {
      const s = await readState(target(flags));
      out(`current:     ${s.current ?? "(none)"}`);
      out(`known-good:  ${s.knownGood.join(", ") || "(none)"}`);
      out(`rolled back: ${s.rolledBack.join(", ") || "(none)"}`);
      return 0;
    }
    case "smoke": {
      let problems: string[];
      if (flags.server) problems = await smokeServer(flags.server);
      else if (flags.url) {
        const r = await smokeUrl(flags.url, flags.origin ?? "https://www.sefaria.org");
        problems = r.problems;
        if (r.version) out(`manifest version ${r.version}`);
      } else if (flags.version) problems = await smokeVersion(target(flags), flags.version);
      else throw new Usage("smoke needs --version <v>, --url <manifest URL> or --server <API origin>");
      if (problems.length) {
        for (const p of problems) console.error(`x ${p}`);
        return 1;
      }
      out("smoke: PASS");
      return 0;
    }
    case "serve": {
      if (!flags.dir) throw new Usage("serve needs --dir <folder>");
      const port = Number(flags.port ?? 3410);
      createReleaseServer(path.resolve(flags.dir)).listen(port, "127.0.0.1", () =>
        out(`release target ${flags.dir} on http://127.0.0.1:${port}/ (stable manifest: /stable/manifest.json)`),
      );
      return new Promise(() => {}); // until killed
    }
    case "check-dockerfile": {
      const file = path.resolve(rest[0] ?? path.join(ROOT, "Dockerfile"));
      const problems = checkDockerfile(await readFile(file, "utf8"));
      if (problems.length) {
        for (const p of problems) console.error(`x ${path.relative(process.cwd(), file)}:${p.line} [${p.rule}] ${p.message}`);
        return 1;
      }
      out(`check-dockerfile: PASS (${path.relative(process.cwd(), file) || file})`);
      return 0;
    }
    default:
      throw new Usage(
        `unknown command "${cmd ?? ""}". Commands: budget, version, publish, promote, rollback, status, smoke, serve, check-dockerfile.`,
      );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: Error) => {
      console.error(`x ${e.message}`);
      process.exit(e instanceof Usage ? 2 : 1);
    },
  );
}
