// Names the atlas entries `factory compile 035` created, so each says what it covers.
// Idempotent: a second run prints "already applied".
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../features.json", import.meta.url);
const ENTRIES = {
  "SESS-060": {
    name: "Floating call window: place, move, resize",
    description:
      "The call floats over the reader in a fixed window, top inline-end by default; sizes pill, small, medium, large; dragged by its handle and snapped to a corner; resized within limits; kept on screen; its place remembered; hidden tiles send no video. The text column never moves.",
    acs: ["035/AC-001", "035/AC-002", "035/AC-003", "035/AC-004", "035/AC-005", "035/AC-006", "035/AC-007", "035/AC-011"],
  },
  "SESS-061": {
    name: "Call window by keyboard and screen reader",
    description:
      "Arrow keys move the window from its handle, a menu offers corners and sizes, moves are announced politely, Escape collapses to the pill without trapping focus, controls are 24 px with focus rings and names, and reduced motion turns animation off.",
    acs: ["035/AC-008", "035/AC-009", "035/AC-010"],
  },
};

const atlas = JSON.parse(readFileSync(FILE, "utf8"));
const list = Array.isArray(atlas) ? atlas : atlas.features;
let changed = 0;
for (const [id, want] of Object.entries(ENTRIES)) {
  const entry = list.find((f) => f.id === id);
  if (!entry) throw new Error(`${id} is not in the atlas; run npm run factory -- compile 035 first`);
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
