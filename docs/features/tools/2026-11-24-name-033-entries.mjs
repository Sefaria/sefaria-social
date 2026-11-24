// Names the two atlas entries `factory compile 033` created with the spec's title, so each says what it covers.
// Idempotent: a second run prints "already applied".
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../features.json", import.meta.url);
const ENTRIES = {
  "API-046": {
    name: "Call token endpoint for room members",
    description:
      "POST /api/v1/rooms/{roomId}/call/token: a member gets a 10-minute LiveKit token for that room only, identity u:<user id>, role in metadata, publish microphone, camera and screen share, no data; 404 for non-members and missing rooms alike, 401 without identity.",
    acs: ["033/AC-001", "033/AC-002", "033/AC-003", "033/AC-004"],
  },
  "SESS-056": {
    name: "Calls switch and the room's calls field",
    description:
      "Calls are available only with LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET set and CALLS_ENABLED=true; otherwise the token request is 503 call.unavailable. Every room response carries calls.available.",
    acs: ["033/AC-005", "033/AC-008"],
  },
};

const atlas = JSON.parse(readFileSync(FILE, "utf8"));
const list = Array.isArray(atlas) ? atlas : atlas.features;
let changed = 0;
for (const [id, want] of Object.entries(ENTRIES)) {
  const entry = list.find((f) => f.id === id);
  if (!entry) throw new Error(`${id} is not in the atlas; run npm run factory -- compile 033 first`);
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
