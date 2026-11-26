// Names the atlas entries `factory compile 053` created, so each says what it covers.
// Idempotent: a second run prints "already applied".
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../features.json", import.meta.url);
const ENTRIES = {
  "SHIUR-006": {
    name: "The shiur player: a bar with chapters, the talking head in place, open to anyone",
    description:
      "A replay has a bar docked at the bottom (play, seek with chapter markers named by ref, back and forward, speed, Hide video, Close, Space and arrows); the video is the talking head pinned where the leader had it, gone while their camera was off or for an audio-only shiur; signed out it loads through the public reads.",
    acs: ["053/AC-001", "053/AC-002", "053/AC-003", "053/AC-004", "053/AC-005"],
    status: "built",
    tests: ["app/src/features/replay/shiur-player.test.tsx", "e2e/recording.spec.ts"],
  },
};

const atlas = JSON.parse(readFileSync(FILE, "utf8"));
const list = Array.isArray(atlas) ? atlas : atlas.features;
let changed = 0;
for (const [id, want] of Object.entries(ENTRIES)) {
  const entry = list.find((f) => f.id === id);
  if (!entry) throw new Error(`${id} is not in the atlas; run npm run factory -- compile 053 first`);
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
