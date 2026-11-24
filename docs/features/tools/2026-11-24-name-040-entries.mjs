// Names the atlas entries `factory compile 040` created, so each says what it covers.
// Idempotent: a second run prints "already applied".
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../features.json", import.meta.url);
const ENTRIES = {
  "OPS-094": {
    name: "Call chunk budget",
    description:
      "The LiveKit call chunk (assets/call.*.js) has its own gzip limit and is left out of the surface totals; the entry may grow at most 4 kB over its size before calls.",
    acs: ["040/AC-001"],
  },
  "OPS-095": {
    name: "Two-browser call journey on a local LiveKit",
    description:
      "The e2e stack runs LiveKit in development mode; two Chromium contexts with fake cameras join one room call on desktop and phone: video and audio arrive, mute shows, the call survives moving, leaving keeps the room.",
    acs: ["040/AC-002", "040/AC-003", "040/AC-004", "040/AC-005"],
  },
};

const atlas = JSON.parse(readFileSync(FILE, "utf8"));
const list = Array.isArray(atlas) ? atlas : atlas.features;
let changed = 0;
for (const [id, want] of Object.entries(ENTRIES)) {
  const entry = list.find((f) => f.id === id);
  if (!entry) throw new Error(`${id} is not in the atlas; run npm run factory -- compile 040 first`);
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
