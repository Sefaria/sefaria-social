// Records answers of Sefaria's public text API (public data) into harness/fixtures/texts/, trimmed to the fields social uses
// and to the first segments, so the harness and the unit tests never call Sefaria. Run by hand when a fixture is added:
//   node harness/fixtures/record-texts.mjs "Genesis 1" "Exodus 3"
// The query is the one app/src/lib/sefaria-text.ts sends (textQuery); a unit test keeps the fixtures parseable by its schema.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const QUERY = "version=primary&version=translation&return_format=text_only";
const KEEP_SEGMENTS = 6;

/** The fixture file name for a ref: spaces and colons become underscores (harness/serve.mjs uses the same rule). */
export const fixtureName = (ref) => `${ref.replace(/[^A-Za-z0-9.-]+/g, "_")}.json`;

for (const ref of process.argv.slice(2)) {
  const res = await fetch(`https://www.sefaria.org/api/v3/texts/${encodeURIComponent(ref)}?${QUERY}`);
  if (!res.ok) throw new Error(`${ref}: ${res.status}`);
  const a = await res.json();
  const trimmed = {
    ref: a.ref,
    heRef: a.heRef,
    title: a.title,
    heTitle: a.heTitle,
    indexTitle: a.indexTitle,
    heIndexTitle: a.heIndexTitle,
    versions: a.versions.map((v) => ({
      language: v.language,
      direction: v.direction,
      versionTitle: v.versionTitle,
      text: Array.isArray(v.text) ? v.text.slice(0, KEEP_SEGMENTS) : v.text,
    })),
  };
  await writeFile(path.join(here, "texts", fixtureName(ref)), `${JSON.stringify(trimmed, null, 2)}\n`);
  console.log(`recorded ${ref}`);
}
