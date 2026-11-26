// Names the atlas entries `factory compile 052` created, so each says what it covers.
// Idempotent: a second run prints "already applied".
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../features.json", import.meta.url);
const ENTRIES = {
  "SHIUR-005": {
    name: "Processing a recording into a seekable asset with a manifest and chapters",
    description:
      "A finished recording is queued on its own row and processed in the background with ffmpeg into media.webm (seekable), audio.m4a, timeline.json and manifest.json with chapters; served by byte range; retried twice with a wait, then failed with the raw chunks kept; safe to run twice.",
    acs: ["052/AC-001", "052/AC-002", "052/AC-003", "052/AC-004", "052/AC-005", "052/AC-006"],
    status: "built",
    tests: ["app/src/api.processing.int.test.ts", "e2e/recording.spec.ts"],
  },
};

const atlas = JSON.parse(readFileSync(FILE, "utf8"));
const list = Array.isArray(atlas) ? atlas : atlas.features;
let changed = 0;
for (const [id, want] of Object.entries(ENTRIES)) {
  const entry = list.find((f) => f.id === id);
  if (!entry) throw new Error(`${id} is not in the atlas; run npm run factory -- compile 052 first`);
  for (const [k, v] of Object.entries(want)) {
    if (JSON.stringify(entry[k]) !== JSON.stringify(v)) {
      entry[k] = v;
      changed++;
      console.log(`${id}.${k} updated`);
    }
  }
}
if (changed) writeFileSync(FILE, `${JSON.stringify(atlas, null, 2)}\n`);
else console.log("already applied");
