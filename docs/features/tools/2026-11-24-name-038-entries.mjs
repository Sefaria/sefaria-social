// Names the atlas entries `factory compile 038` created, so each says what it covers.
// Idempotent: a second run prints "already applied".
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../features.json", import.meta.url);
const ENTRIES = {
  "API-047": {
    name: "LiveKit webhooks, call status, and deletion leaving calls",
    description:
      "POST /api/v1/internal/livekit/webhook verified with the LiveKit secret, idempotent on the event id, keeps call_status (live, participants) per room; a deleted account is removed from every live call through LiveKit, a failure retried once and logged without stopping the deletion.",
    acs: ["038/AC-001", "038/AC-002", "038/AC-003", "038/AC-005", "038/AC-006"],
  },
  "ROOM-045": {
    name: "N on a call in the lobby and on cards",
    description:
      "The lobby and live room cards say how many are on the room call, and nothing when no call is live or LiveKit is not configured.",
    acs: ["038/AC-004"],
  },
};

const atlas = JSON.parse(readFileSync(FILE, "utf8"));
const list = Array.isArray(atlas) ? atlas : atlas.features;
let changed = 0;
for (const [id, want] of Object.entries(ENTRIES)) {
  const entry = list.find((f) => f.id === id);
  if (!entry) throw new Error(`${id} is not in the atlas; run npm run factory -- compile 038 first`);
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
