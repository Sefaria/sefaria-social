// Names the atlas entries `factory compile 054` created, so each says what it covers.
// Idempotent: a second run prints "already applied".
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../features.json", import.meta.url);
const ENTRIES = {
  "SHIUR-007": {
    name: "A shiur's transcript from Sofer.ai, in the leader's language, line by line in the player",
    description:
      "A processed shiur's audio goes to Sofer.ai in the language the leader chose beside Record (English with Hebrew words in Hebrew letters by default); the job polls until done and keeps the words with their times; the transcript and audio are public reads; without a key it is unavailable, a Sofer.ai failure is failed, and the shiur plays either way; the player shows the line being said under the bar.",
    acs: ["054/AC-001", "054/AC-002", "054/AC-003", "054/AC-004", "054/AC-005", "054/AC-006"],
    status: "built",
    tests: [
      "app/src/api.transcripts.int.test.ts",
      "app/src/features/recording/transcript-language.test.tsx",
      "app/src/features/replay/shiur-player.test.tsx",
    ],
  },
};

const atlas = JSON.parse(readFileSync(FILE, "utf8"));
const list = Array.isArray(atlas) ? atlas : atlas.features;
let changed = 0;
for (const [id, want] of Object.entries(ENTRIES)) {
  const entry = list.find((f) => f.id === id);
  if (!entry) throw new Error(`${id} is not in the atlas; run npm run factory -- compile 054 first`);
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
