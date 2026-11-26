// Sefaria checks and expands refs for Social, which has no text library (spec 060; plan 6.5): `POST <SEFARIA_API_ORIGIN>/api/refs/expand`
// with `{"refs": [...]}` (at most 200) answers, in order, `{"results": [{input, ok: true, ref, heRef, sectionRefs, segmentRefs}
// | {input, ok: false, error}]}`. The answer is validated with zod; no answer in 10 seconds, an error status or an answer of
// another shape is `RefsUnavailable`, never a guess. Tests fake Sefaria by this HTTP surface (test/integration/fake-sefaria.ts).
import { z } from "zod";
import { getConfig } from "../config";

export const EXPAND_TIMEOUT_MS = 10_000;
export const EXPAND_MAX_REFS = 200;

const Ok = z.object({
  input: z.string(),
  ok: z.literal(true),
  ref: z.string().min(1),
  heRef: z.string(),
  sectionRefs: z.array(z.string().min(1)),
  segmentRefs: z.array(z.string().min(1)),
});
const Failed = z.object({ input: z.string(), ok: z.literal(false), error: z.string() });
const ExpandAnswer = z.object({ results: z.array(z.discriminatedUnion("ok", [Ok, Failed])) });

export type ExpandedRef = z.infer<typeof Ok>;
export type ExpandResult = ExpandedRef | z.infer<typeof Failed>;

/** Sefaria could not be asked; the save answers 503 asset.refs_unavailable. */
export class RefsUnavailable extends Error {
  constructor(reason: string) {
    super(`sefaria ref expansion unavailable: ${reason}`);
    this.name = "RefsUnavailable";
  }
}

/** Check and expand refs, one result per input in the same order. */
export async function expandRefs(refs: string[]): Promise<ExpandResult[]> {
  if (refs.length === 0) return [];
  if (refs.length > EXPAND_MAX_REFS) throw new RangeError(`at most ${EXPAND_MAX_REFS} refs per call`);
  const url = new URL("/api/refs/expand", getConfig().SEFARIA_API_ORIGIN);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ refs }),
      signal: AbortSignal.timeout(EXPAND_TIMEOUT_MS),
    });
  } catch (e) {
    throw new RefsUnavailable(e instanceof Error ? e.name : "network");
  }
  if (!res.ok) throw new RefsUnavailable(`status ${res.status}`);
  const parsed = ExpandAnswer.safeParse(await res.json().catch(() => null));
  if (!parsed.success || parsed.data.results.length !== refs.length) throw new RefsUnavailable("unexpected answer");
  return parsed.data.results;
}

/** The section a segment belongs to: the expand answer's section ref it starts with, else the segment without its last part. */
export function sectionOf(segment: string, sectionRefs: readonly string[]): string {
  const found = sectionRefs.filter((s) => segment.startsWith(`${s}:`)).sort((a, b) => b.length - a.length)[0];
  if (found) return found;
  const cut = segment.lastIndexOf(":");
  return cut > 0 ? segment.slice(0, cut) : segment;
}
