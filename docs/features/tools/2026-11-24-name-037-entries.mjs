// Names the atlas entries `factory compile 037` created, so each says what it covers.
// Idempotent: a second run prints "already applied".
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../features.json", import.meta.url);
const ENTRIES = {
  "SESS-062": {
    name: "The call on a phone: a docked strip",
    description:
      "Below 600px the call is a full-width strip under the top inset: 48px collapsed (avatars, speaking, microphone, Leave, Expand; no video received), the active speaker at 16:9 when expanded. Rotating switches between strip and window without touching the call. After the browser pauses a background tab, one Resume button restarts audio.",
    acs: ["037/AC-001", "037/AC-002", "037/AC-003", "037/AC-004", "037/AC-005"],
  },
};

const atlas = JSON.parse(readFileSync(FILE, "utf8"));
const list = Array.isArray(atlas) ? atlas : atlas.features;
let changed = 0;
for (const [id, want] of Object.entries(ENTRIES)) {
  const entry = list.find((f) => f.id === id);
  if (!entry) throw new Error(`${id} is not in the atlas; run npm run factory -- compile 037 first`);
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
