// `npm run atlas:build [-- --out <file>]`: render docs/features/features.json to one static HTML page (plan 5.10).
// No external assets; filter by area and status; links to each spec folder and tagged test (relative to the repo root,
// or to `--repo-url` when given, e.g. https://github.com/<org>/<repo>/blob/main).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FEATURES, loadFeatures, listSpecs } from "./lib/spec.mjs";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function renderAtlas(root, repoUrl = "") {
  const { data } = loadFeatures(root);
  const features = data.features ?? [];
  const specDirs = Object.fromEntries(listSpecs(root).map((s) => [s.id, s.dir]));
  const link = (p) => (repoUrl ? `${repoUrl.replace(/\/$/, "")}/${p}` : `../../${p}`);
  const areas = [...new Set(features.map((f) => f.area))].sort();
  const statuses = ["planned", "built", "verified", "retired"];
  const rows = features
    .map((f) => {
      const spec = f.spec ? (specDirs[f.spec] ? `<a href="${esc(link(specDirs[f.spec]))}">${esc(f.spec)}</a>` : esc(f.spec)) : "";
      const tests = (f.tests ?? []).map((t) => `<a href="${esc(link(t))}">${esc(t)}</a>`).join("<br>");
      return `<tr data-area="${esc(f.area)}" data-status="${esc(f.status)}"><td><code>${esc(f.id)}</code></td><td>${esc(f.name)}<div class="d">${esc(f.description)}</div></td><td><span class="s ${esc(f.status)}">${esc(f.status)}</span></td><td>${spec}</td><td>${esc((f.acs ?? []).join(", "))}</td><td>${tests}</td><td>${esc(f.since ?? "")}</td></tr>`;
    })
    .join("\n");
  const opts = (xs) => xs.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feature atlas</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#ddd;--planned:#8a6d00;--built:#0b5cad;--verified:#1d7a3a;--retired:#777}
@media (prefers-color-scheme: dark){:root{--bg:#141414;--fg:#eee;--muted:#aaa;--line:#333;--planned:#e0b400;--built:#6cb2ff;--verified:#5fd081;--retired:#999}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 8px}p{color:var(--muted);margin:0 0 12px}
.f{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}select{font:inherit;padding:4px}
.w{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.d{color:var(--muted);font-size:13px}.s{font-weight:600}.planned{color:var(--planned)}.built{color:var(--built)}.verified{color:var(--verified)}.retired{color:var(--retired)}
a{color:inherit}
</style></head><body>
<h1>Feature atlas</h1>
<p>Generated from <code>${esc(FEATURES)}</code>. ${features.length} feature(s).</p>
<div class="f"><label>Area <select id="area"><option value="">all</option>${opts(areas)}</select></label>
<label>Status <select id="status"><option value="">all</option>${opts(statuses)}</select></label></div>
<div class="w"><table><thead><tr><th>Id</th><th>Feature</th><th>Status</th><th>Spec</th><th>ACs</th><th>Tests</th><th>Since</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>
<script>
const a=document.getElementById("area"),s=document.getElementById("status");
function f(){for(const r of document.querySelectorAll("tbody tr")){r.hidden=(a.value&&r.dataset.area!==a.value)||(s.value&&r.dataset.status!==s.value)}}
a.onchange=f;s.onchange=f;
</script>
</body></html>
`;
}

export function runAtlasBuild(root, args, out) {
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const outFile = path.resolve(root, get("--out") ?? "dist/atlas/index.html");
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, renderAtlas(root, get("--repo-url") ?? ""));
  out.log(`atlas:build: wrote ${path.relative(root, outFile)}`);
  return 0;
}
