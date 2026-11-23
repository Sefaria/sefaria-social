// A release and a rollback, end to end, locally (spec 020 AC-006; plan 8 P5's exit test, adapted: there is no staging yet).
// Build two versions of the surface → publish each to a filesystem release target → promote → serve the target over HTTP on
// another origin (like the asset origin) → load it in the harness through the stable manifest, as the reader does (origin
// allowlist, integrity on every file) → roll back with scripts/rollback → the harness loads the first version again. Then an
// altered published file must stop the load (SRI), and the HTTP smoke test must catch it too.
// Recorded in docs/runbooks/rollback-rehearsal-local.md.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";

const exec = promisify(execFile);

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = path.join(ROOT, "node_modules", ".bin");
const PORT = Number(process.env.RELEASE_E2E_PORT) || 3410;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const STABLE = `${ORIGIN}/stable/manifest.json`;

let work: string;
let server: ChildProcess;
const targetDir = () => path.join(work, "target");
const CLI = path.join(ROOT, "app/scripts/release/cli.ts");

async function build(version: string): Promise<string> {
  const out = path.join(work, `build-${version}`);
  await exec(
    path.join(BIN, "vite"),
    ["build", "-c", "vite.surface.config.ts", "--configLoader", "runner", "--logLevel", "warn"],
    {
      cwd: path.join(ROOT, "app"),
      env: { ...process.env, SURFACE_VERSION: version, SURFACE_OUT_DIR: out },
    },
  );
  return out;
}

/** Runs a command the way an operator would (asynchronously: the smoke test talks to the release server over HTTP). */
async function run(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  try {
    const r = await exec(cmd, args, {
      cwd: ROOT,
      env: { ...process.env, RELEASE_TARGET: `file:${targetDir()}` },
      timeout: 60_000,
    });
    return { code: 0, out: `${r.stdout}${r.stderr}` };
  } catch (e) {
    const err = e as { code: number; stdout: string; stderr: string };
    return { code: typeof err.code === "number" ? err.code : -1, out: `${err.stdout}${err.stderr}` };
  }
}
const release = (...args: string[]) => run(path.join(BIN, "tsx"), [CLI, ...args]);

/** Open the harness configured like a reader whose PUBLIC_SOCIAL_MANIFEST_URL is the stable pointer. */
async function load(page: Page): Promise<{ state: string; label: string; fetched: string[] }> {
  const fetched: string[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith(ORIGIN)) fetched.push(new URL(r.url()).pathname);
  });
  await page.addInitScript(
    ([manifestUrl, origin]) => {
      (window as unknown as { __HARNESS_CONFIG__: unknown }).__HARNESS_CONFIG__ = { manifestUrl, allowedOrigins: [origin] };
    },
    [STABLE, ORIGIN] as const,
  );
  await page.goto("/social");
  await expect(page.locator("body[data-surface-state]")).toBeAttached({ timeout: 15_000 });
  return {
    state: (await page.locator("body").getAttribute("data-surface-state")) ?? "",
    label: (await page.locator("[data-harness=surface]").textContent()) ?? "",
    fetched,
  };
}

test.beforeAll(async () => {
  work = mkdtempSync(path.join(tmpdir(), "release-e2e-"));
  mkdirSync(targetDir());
  // The asset origin: `release serve` over the filesystem target, in its own process, on another origin than the harness.
  server = spawn(path.join(BIN, "tsx"), [CLI, "serve", "--dir", targetDir(), "--port", String(PORT)], {
    cwd: ROOT,
    stdio: "pipe",
  });
  await new Promise<void>((resolve, reject) => {
    server.stdout!.on("data", (d: Buffer) => d.toString().includes(`127.0.0.1:${PORT}`) && resolve());
    server.on("exit", (code) => reject(new Error(`release serve exited with ${code}`)));
    setTimeout(() => reject(new Error("release serve did not start")), 20_000);
  });
});

test.afterAll(async () => {
  server?.kill("SIGTERM");
  rmSync(work, { recursive: true, force: true });
});

// @feature OPS-020 Release pipeline with versioned assets, a stable pointer and rollback
// @ac 020/AC-006
test("two releases, a rollback, and an altered file, through the stable manifest", async ({ browser }) => {
  test.setTimeout(120_000);
  const v1 = "e2e.1";
  const v2 = "e2e.2";
  const [b1, b2] = await Promise.all([build(v1), build(v2)]);

  // Version 1: publish, promote, load.
  expect((await release("publish", "--dir", b1)).code).toBe(0);
  expect(await release("promote", v1)).toMatchObject({ code: 0 });
  let page = await browser.newPage();
  let seen = await load(page);
  expect(seen.state).toBe("loaded");
  expect(seen.label).toBe(`social@${v1}`);
  await expect(page.locator("[data-surface-mount=page] main h1")).toHaveText("Sefaria Social");
  const assets1 = seen.fetched.filter((p) => p.endsWith(".js") || p.endsWith(".css"));
  expect(assets1.length).toBeGreaterThan(1);
  for (const p of assets1) expect(p).toMatch(new RegExp(`^/v/${v1.replace(".", "\\.")}/assets/`));
  await page.close();

  // Version 2: publish, promote, load.
  expect((await release("publish", "--dir", b2)).code).toBe(0);
  expect((await release("promote", v2)).code).toBe(0);
  expect((await release("smoke", "--url", STABLE, "--origin", "http://localhost:3300")).code).toBe(0);
  page = await browser.newPage();
  seen = await load(page);
  expect(seen.state).toBe("loaded");
  expect(seen.label).toBe(`social@${v2}`);
  for (const p of seen.fetched.filter((x) => x.endsWith(".js"))) expect(p).toMatch(/^\/v\/e2e\.2\/assets\//);
  await page.close();

  // Roll back with the script an operator runs: the stable pointer moves to version 1 and the harness loads it again.
  const rb = await run(path.join(ROOT, "scripts/rollback"), []);
  expect(rb.out).toContain(`stable -> ${v1}`);
  expect(rb.code).toBe(0);
  expect((await release("status")).out).toMatch(
    new RegExp(`current:\\s+${v1.replace(".", "\\.")}[\\s\\S]*rolled back:\\s+${v2.replace(".", "\\.")}`),
  );
  page = await browser.newPage();
  seen = await load(page);
  expect(seen.state).toBe("loaded");
  expect(seen.label).toBe(`social@${v1}`);
  await expect(page.locator("[data-surface-mount=page] main h1")).toHaveText("Sefaria Social");
  await page.close();

  // An altered published chunk: the HTTP smoke test reports it, and the harness refuses to run it (SRI on a chunk alone).
  const assetsDir = path.join(targetDir(), "v", v1, "assets");
  const chunk = readdirSync(assetsDir)
    .filter((f) => f.startsWith("chunk."))
    .map((f) => path.join(assetsDir, f))
    .sort((a, b) => readFileSync(b).length - readFileSync(a).length)[0]!;
  const original = readFileSync(chunk);
  writeFileSync(chunk, Buffer.concat([original, Buffer.from("\n/* altered */\n")]));
  try {
    const smoke = await release("smoke", "--url", STABLE, "--origin", "http://localhost:3300");
    expect(smoke.code).toBe(1);
    expect(smoke.out).toContain("does not match its integrity hash");
    page = await browser.newPage();
    seen = await load(page);
    expect(seen.state).toBe("failed");
    await page.close();
  } finally {
    writeFileSync(chunk, original);
  }
});
