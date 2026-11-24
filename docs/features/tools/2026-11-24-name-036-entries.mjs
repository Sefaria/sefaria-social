// Names the atlas entries `factory compile 036` created, so each says what it covers.
// Idempotent: a second run prints "already applied".
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../features.json", import.meta.url);
const ENTRIES = {
  "HOST-008": {
    name: "SurfaceHost 1.2 chrome insets for the call window",
    description:
      "The pinned contract is SurfaceHost 1.2 with an optional ui.chrome (the reader chrome insets); the call window keeps inside the viewport minus them and re-places when they change, falls back to a 64px top inset on an older reader, and reports bad values once. The fake host offers settable insets and a 1.1 variant.",
    acs: ["036/AC-001", "036/AC-002", "036/AC-003", "036/AC-004", "036/AC-005"],
  },
};

const atlas = JSON.parse(readFileSync(FILE, "utf8"));
const list = Array.isArray(atlas) ? atlas : atlas.features;
let changed = 0;
for (const [id, want] of Object.entries(ENTRIES)) {
  const entry = list.find((f) => f.id === id);
  if (!entry) throw new Error(`${id} is not in the atlas; run npm run factory -- compile 036 first`);
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
