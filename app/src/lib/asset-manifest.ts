// The manifest inside a Claude asset's file (spec 060; Sefaria-Project LINKED_PANELS_AND_ASSETS_PLAN.md 5.1): one
// `<script type="application/json" id="sefaria-asset">` block holding `{v: 1, title, description?, lang?, refs: [{ref, label?}]}`.
// Read with a regular expression over the text, never by running or parsing the page as HTML. Every failure is a problem with
// a stable code and a message that tells the author (often a model) what to change.
import { z } from "zod";

export interface AssetProblem {
  code: string;
  message: string;
  /** The declared ref the problem is about, when there is one. */
  ref?: string;
}

export interface AssetManifest {
  v: 1;
  title: string;
  description: string;
  lang: string | null;
  refs: { ref: string; label: string | null }[];
}

export const MANIFEST_ID = "sefaria-asset";
export const MAX_REFS = 100;

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const attr = (attrs: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
};

const Ref = z.object({
  ref: z.string().trim().min(1).max(300),
  label: z.string().trim().max(200).nullish(),
});
const Manifest = z.object({
  v: z.literal(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  lang: z.string().trim().max(20).optional(),
  refs: z.array(Ref),
});

const problem = (code: string, message: string): { ok: false; problems: AssetProblem[] } => ({
  ok: false,
  problems: [{ code, message }],
});

export type ManifestResult = { ok: true; manifest: AssetManifest } | { ok: false; problems: AssetProblem[] };

export function readManifest(html: string): ManifestResult {
  const blocks = [...html.matchAll(SCRIPT)].filter((m) => attr(m[1] ?? "", "id") === MANIFEST_ID);
  if (blocks.length === 0)
    return problem(
      "manifest.missing",
      `The file has no manifest. Add <script type="application/json" id="${MANIFEST_ID}"> with {"v": 1, "title": …, "refs": [{"ref": …}]} inside the file.`,
    );
  if (blocks.length > 1)
    return problem(
      "manifest.multiple",
      `The file has ${blocks.length} manifest blocks with id="${MANIFEST_ID}". Keep exactly one.`,
    );
  const [, attrs = "", body = ""] = blocks[0]!;
  if ((attr(attrs, "type") ?? "").toLowerCase() !== "application/json")
    return problem("manifest.invalid", `The manifest block must have type="application/json".`);
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return problem("manifest.json", "The manifest is not valid JSON. Check quotes, commas and brackets inside the block.");
  }
  if (typeof json !== "object" || json === null || Array.isArray(json))
    return problem("manifest.invalid", 'The manifest must be a JSON object: {"v": 1, "title": …, "refs": […]}.');
  const v = (json as { v?: unknown }).v;
  if (v !== 1) return problem("manifest.version", `The manifest's "v" must be 1 (found ${JSON.stringify(v ?? null)}).`);
  const parsed = Manifest.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0]!;
    const field = first.path.join(".") || "manifest";
    return problem(
      "manifest.invalid",
      `The manifest's "${field}" is not valid: ${first.message}. Give "title" (1–200 characters) and "refs".`,
    );
  }
  const m = parsed.data;
  if (m.refs.length === 0)
    return problem("refs.missing", 'The manifest declares no refs. Add at least one, for example {"ref": "Genesis 1:1-5"}.');
  if (m.refs.length > MAX_REFS)
    return problem("refs.too_many", `The manifest declares ${m.refs.length} refs; at most ${MAX_REFS} are allowed. Use ranges.`);
  return {
    ok: true,
    manifest: {
      v: 1,
      title: m.title,
      description: m.description ?? "",
      lang: m.lang ?? null,
      refs: m.refs.map((r) => ({ ref: r.ref, label: r.label ?? null })),
    },
  };
}
