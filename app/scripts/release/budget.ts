// `npm run surface:budget` (spec 019): the surface build against app/surface-budget.json. Measures what the reader downloads
// (the files the manifest lists: entry, chunks, CSS), raw and gzip (level 9), and fails with the fix when a budget is exceeded.
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
}

export interface FileSize {
  path: string;
  raw: number;
  gzip: number;
  entry: boolean;
}

export const BUDGET_KEYS: (keyof Budget)[] = ["entryGzip", "largestChunkGzip", "totalGzip", "totalRaw", "files"];

export async function readBudget(file: string): Promise<Budget> {
  const json = JSON.parse(await readFile(file, "utf8")) as Partial<Budget>;
  for (const k of BUDGET_KEYS)
    if (typeof json[k] !== "number" || json[k] <= 0) throw new Error(`${file}: "${k}" must be a positive number`);
  return json as Budget;
}

export async function measure(buildDir: string): Promise<{ sizes: FileSize[]; missing: string[] }> {
  const manifest = parseManifest(await readFile(path.join(buildDir, MANIFEST), "utf8"), `${buildDir}/${MANIFEST}`);
  const sizes: FileSize[] = [];
  const missing: string[] = [];
  for (const [p, entry] of [[manifest.entry, true], ...manifest.files.map((f) => [f.path, false])] as [string, boolean][]) {
    const body = await readFile(path.join(buildDir, p)).catch(() => null);
    if (!body) missing.push(p);
    else sizes.push({ path: p, raw: body.length, gzip: gzipSync(body, { level: 9 }).length, entry });
  }
  return { sizes, missing };
}

export function totals(sizes: FileSize[]): Budget {
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
    lines.push(`${(s.entry ? `${s.path} (entry)` : s.path).padEnd(40)} ${kB(s.raw).padStart(9)} ${kB(s.gzip).padStart(10)}`);
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
  return { ok: failures.length === 0, report: lines.join("\n"), failures };
}
