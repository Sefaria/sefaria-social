// Names the atlas entries `factory compile 039` created, so each says what it covers.
// Idempotent: a second run prints "already applied".
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../features.json", import.meta.url);
const ENTRIES = {
  "API-048": {
    name: "Owner mutes or removes a call participant",
    description:
      "POST .../call/mute and .../call/remove, owner only (403 member, 404 outsider, 503 when calls are off), through LiveKit server API; removal keeps them in the room and refuses their call tokens for 15 minutes (call_removals).",
    acs: ["039/AC-001", "039/AC-002", "039/AC-003", "039/AC-004", "039/AC-005"],
  },
  "SESS-063": {
    name: "Owner tile menu, and what the muted and removed see",
    description:
      "An owner sees a menu on every other tile (mute microphone, turn off camera, stop screen share, remove); the muted are told the host muted them and can unmute; the removed are told so and stay in the room.",
    acs: ["039/AC-006", "039/AC-007"],
  },
};

const atlas = JSON.parse(readFileSync(FILE, "utf8"));
const list = Array.isArray(atlas) ? atlas : atlas.features;
let changed = 0;
for (const [id, want] of Object.entries(ENTRIES)) {
  const entry = list.find((f) => f.id === id);
  if (!entry) throw new Error(`${id} is not in the atlas; run npm run factory -- compile 039 first`);
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
