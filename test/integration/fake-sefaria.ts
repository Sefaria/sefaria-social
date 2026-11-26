// A fake of Sefaria's ref expansion, by its real HTTP surface (spec 060; tests rule 4): `POST /api/refs/expand` with
// `{"refs": [...]}` answers `{"results": [{input, ok: true, ref, heRef, sectionRefs, segmentRefs} | {input, ok: false, error}]}`.
// It knows Genesis and Exodus, 50 and 40 chapters of 31 verses each, in the forms "Book C", "Book C:V" and "Book C:V-W"
// (a range may cross chapters: "Book C:V-D:W"), any case. A test can make it fail (`mode`).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const BOOKS: Record<string, { he: string; chapters: number }> = {
  genesis: { he: "בראשית", chapters: 50 },
  exodus: { he: "שמות", chapters: 40 },
};
const VERSES = 31;
const REF = /^\s*([A-Za-z]+)\s+(\d+)(?::(\d+))?(?:\s*-\s*(?:(\d+):)?(\d+))?\s*$/;

type Result =
  | { input: string; ok: true; ref: string; heRef: string; sectionRefs: string[]; segmentRefs: string[] }
  | { input: string; ok: false; error: string };

export function expandOne(input: string): Result {
  const m = REF.exec(input);
  const book = m ? BOOKS[m[1]!.toLowerCase()] : undefined;
  if (!m || !book) return { input, ok: false, error: `Could not find title in "${input}"` };
  const name = m[1]![0]!.toUpperCase() + m[1]!.slice(1).toLowerCase();
  const c1 = Number(m[2]);
  const v1 = m[3] ? Number(m[3]) : 1;
  const c2 = m[4] ? Number(m[4]) : c1;
  const v2 = m[5] ? Number(m[5]) : m[3] ? v1 : VERSES;
  const bad = [c1, c2].some((c) => c < 1 || c > book.chapters) || [v1, v2].some((v) => v < 1 || v > VERSES);
  if (bad || c2 < c1 || (c2 === c1 && v2 < v1)) return { input, ok: false, error: `"${input}" is not a valid ref` };
  const segmentRefs: string[] = [];
  const sectionRefs: string[] = [];
  for (let c = c1; c <= c2; c++) {
    sectionRefs.push(`${name} ${c}`);
    for (let v = c === c1 ? v1 : 1; v <= (c === c2 ? v2 : VERSES); v++) segmentRefs.push(`${name} ${c}:${v}`);
  }
  const ref = !m[3]
    ? `${name} ${c1}`
    : c1 === c2
      ? v1 === v2
        ? `${name} ${c1}:${v1}`
        : `${name} ${c1}:${v1}-${v2}`
      : `${name} ${c1}:${v1}-${c2}:${v2}`;
  return { input, ok: true, ref, heRef: `${book.he} ${ref.slice(name.length + 1)}`, sectionRefs, segmentRefs };
}

export interface FakeSefaria {
  origin: string;
  /** "ok" answers; "error" answers 500; "garbage" answers 200 with a body that is not the schema. */
  mode: "ok" | "error" | "garbage";
  /** The refs asked for, per request. */
  requests: string[][];
  close: () => Promise<void>;
}

export async function startFakeSefaria(): Promise<FakeSefaria> {
  const fake: FakeSefaria = { origin: "", mode: "ok", requests: [], close: async () => undefined };
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
    req.on("end", () => {
      if (req.method !== "POST" || req.url !== "/api/refs/expand") return void res.writeHead(404).end();
      if (fake.mode === "error") return void res.writeHead(500).end("boom");
      if (fake.mode === "garbage") {
        res.writeHead(200, { "content-type": "application/json" });
        return void res.end(JSON.stringify({ results: [{ nope: true }] }));
      }
      const body = JSON.parse(raw) as { refs: string[] };
      fake.requests.push(body.refs);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ results: body.refs.map(expandOne) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return fake;
}

/** A Claude asset file declaring these refs (and an optional title and description). */
export function assetHtml(
  refs: (string | { ref: string; label?: string })[],
  opts: { title?: string; description?: string; extra?: string } = {},
): string {
  const manifest = {
    v: 1,
    title: opts.title ?? "The Seven Days",
    description: opts.description ?? "A scrolling story of creation, tied to Genesis 1.",
    lang: "en",
    refs: refs.map((r) => (typeof r === "string" ? { ref: r } : r)),
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${manifest.title}</title>
<script type="application/json" id="sefaria-asset">${JSON.stringify(manifest)}</script>
</head><body><main id="scene"></main><script>document.getElementById("scene").textContent = "Day one";${opts.extra ?? ""}</script></body></html>
`;
}
