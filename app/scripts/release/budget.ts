// `npm run surface:budget` (spec 019): the surface build against app/surface-budget.json. Measures what the reader downloads
// (the files the manifest lists: entry, chunks, CSS), raw and gzip (level 9), and fails with the fix when a budget is exceeded.
// Spec 040: the call chunk (assets/call.*.js: LiveKit, loaded only when a viewer joins a call) is measured against its own
// limit, `callChunkGzip`, and left out of the other totals, which keep measuring what every lab reader downloads. With
// `entryGzipBeforeCalls`, the entry may be at most ENTRY_GROWTH_SINCE_CALLS bytes larger than it was before calls.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { MANIFEST, parseManifest } from "./manifest";

export interface Budget {
  /** Gzip bytes of the entry module (what every lab page fetches before anything mounts). */
  entryGzip: number;
  /** Gzip bytes of the largest non-entry file. */
  largestChunkGzip: number;
  /** Gzip bytes of every listed file together. */
  totalGzip: number;
  /** Raw bytes of every listed file together (an unminified build fails here). */
  totalRaw: number;
  /** Number of listed files (each one is a request and a modulepreload). */
  files: number;
  /** Gzip bytes of the call chunk (spec 040). Required when the build has one. */
  callChunkGzip?: number;
  /** Gzip bytes of the entry before calls were added (spec 040): the entry may grow at most ENTRY_GROWTH_SINCE_CALLS. */
  entryGzipBeforeCalls?: number;
}

/** How much the entry may grow because of calls (spec 040 AC-001). */
export const ENTRY_GROWTH_SINCE_CALLS = 4_000;
/** The call chunk's file name, set by app/vite.surface.config.ts. */
export const CALL_CHUNK = /^assets\/call\.[^/]+\.js$/;

export interface FileSize {
  path: string;
  raw: number;
  gzip: number;
  entry: boolean;
  /** The call chunk: measured on its own (spec 040). */
  call: boolean;
}

export const BUDGET_KEYS: (keyof Budget)[] = ["entryGzip", "largestChunkGzip", "totalGzip", "totalRaw", "files"];

export async function readBudget(file: string): Promise<Budget> {
  const json = JSON.parse(await readFile(file, "utf8")) as Partial<Budget>;
  for (const k of BUDGET_KEYS)
    if (typeof json[k] !== "number" || json[k] <= 0) throw new Error(`${file}: "${k}" must be a positive number`);
  for (const k of ["callChunkGzip", "entryGzipBeforeCalls"] as const)
    if (json[k] !== undefined && (typeof json[k] !== "number" || json[k] <= 0))
      throw new Error(`${file}: "${k}" must be a positive number when set`);
  return json as Budget;
}

export async function measure(buildDir: string): Promise<{ sizes: FileSize[]; missing: string[] }> {
  const manifest = parseManifest(await readFile(path.join(buildDir, MANIFEST), "utf8"), `${buildDir}/${MANIFEST}`);
  const sizes: FileSize[] = [];
  const missing: string[] = [];
  for (const [p, entry] of [[manifest.entry, true], ...manifest.files.map((f) => [f.path, false])] as [string, boolean][]) {
    const body = await readFile(path.join(buildDir, p)).catch(() => null);
    if (!body) missing.push(p);
    else sizes.push({ path: p, raw: body.length, gzip: gzipSync(body, { level: 9 }).length, entry, call: CALL_CHUNK.test(p) });
  }
  return { sizes, missing };
}

/** The five shared budgets, over every file but the call chunk. */
export function totals(all: FileSize[]): Budget {
  const sizes = all.filter((s) => !s.call);
  const chunks = sizes.filter((s) => !s.entry);
  return {
    entryGzip: sizes.find((s) => s.entry)?.gzip ?? 0,
    largestChunkGzip: Math.max(0, ...chunks.map((s) => s.gzip)),
    totalGzip: sizes.reduce((n, s) => n + s.gzip, 0),
    totalRaw: sizes.reduce((n, s) => n + s.raw, 0),
    files: sizes.length,
  };
}

const kB = (n: number) => `${(n / 1000).toFixed(1)} kB`;
const fmt = (k: keyof Budget, n: number) => (k === "files" ? String(n) : kB(n));

export async function checkBudget(
  buildDir: string,
  budgetFile: string,
): Promise<{ ok: boolean; report: string; failures: string[] }> {
  const budget = await readBudget(budgetFile);
  const { sizes, missing } = await measure(buildDir);
  const t = totals(sizes);
  const lines = ["file                                     raw        gzip"];
  for (const s of [...sizes].sort((a, b) => b.gzip - a.gzip))
    lines.push(
      `${(s.entry ? `${s.path} (entry)` : s.call ? `${s.path} (call)` : s.path).padEnd(40)} ${kB(s.raw).padStart(9)} ${kB(s.gzip).padStart(10)}`,
    );
  lines.push("", "budget             measured      limit");
  const failures: string[] = [];
  for (const m of missing)
    failures.push(`${m} is listed in the manifest but missing from ${buildDir}. Fix: rebuild with 'npm run build:surface'.`);
  for (const k of BUDGET_KEYS) {
    const over = t[k] > budget[k];
    lines.push(`${k.padEnd(18)} ${fmt(k, t[k]).padStart(9)}  ${fmt(k, budget[k]).padStart(9)}  ${over ? "OVER" : "ok"}`);
    if (over)
      failures.push(
        `${k} is ${fmt(k, t[k])}, over its budget of ${fmt(k, budget[k])}. Fix: find what grew (the table above; the .map files show which modules), ` +
          `lazy-load it or drop it; raise the limit in ${path.basename(budgetFile)} only with a reviewer's agreement and a reason in the PR.`,
      );
  }
  // Spec 040: the call chunk's own limit, and the entry's growth since calls.
  const extra: [string, number, number][] = [];
  const calls = sizes.filter((s) => s.call);
  for (const c of calls)
    if (budget.callChunkGzip === undefined)
      failures.push(
        `${c.path} is a call chunk but ${path.basename(budgetFile)} has no "callChunkGzip". Fix: add "callChunkGzip" (the call chunk's gzip size plus 10–20 % headroom) with a reviewer's agreement.`,
      );
  if (budget.callChunkGzip !== undefined)
    extra.push(["callChunkGzip", Math.max(0, ...calls.map((c) => c.gzip)), budget.callChunkGzip]);
  if (budget.entryGzipBeforeCalls !== undefined)
    extra.push(["entryGrowthSinceCalls", Math.max(0, t.entryGzip - budget.entryGzipBeforeCalls), ENTRY_GROWTH_SINCE_CALLS]);
  for (const [k, measured, limit] of extra) {
    const over = measured > limit;
    lines.push(`${k.padEnd(18)} ${kB(measured).padStart(9)}  ${kB(limit).padStart(9)}  ${over ? "OVER" : "ok"}`);
    if (over)
      failures.push(
        `${k} is ${kB(measured)}, over its budget of ${kB(limit)}. Fix: find what grew (the table above; the .map files show which modules); ` +
          `keep call code behind the dynamic import in features/av/load-livekit.ts; raise a limit only with a reviewer's agreement and a reason in the PR.`,
      );
  }
  return { ok: failures.length === 0, report: lines.join("\n"), failures };
}
