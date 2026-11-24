// Names the atlas entries `factory compile 034` created, so each says what it covers.
// Idempotent: a second run prints "already applied".
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../features.json", import.meta.url);
const ENTRIES = {
  "SESS-057": {
    name: "Call state machine and controller",
    description:
      "One call per tab, tied to a room session: pre-join, connecting, in call, reconnecting with a fresh token (30 s, then Rejoin), ended. Leaving the call keeps the room; leaving the room ends the call first. Reports carry no personal data.",
    acs: ["034/AC-001", "034/AC-007", "034/AC-008", "034/AC-011", "034/AC-012"],
  },
  "SESS-058": {
    name: "Join a call with devices off, and talk",
    description:
      "Join call in the lobby and the follow bar when calls are available; a pre-join step with microphone and camera off, device choosers and a preview; denied permission still lets you listen; tiles, microphone, camera and screen share controls.",
    acs: ["034/AC-002", "034/AC-004", "034/AC-005", "034/AC-006"],
  },
  "SESS-059": {
    name: "Calls load on demand and survive reading",
    description:
      "No LiveKit code, connection or device request before Join call; the call stays connected through every in-reader navigation; a reload offers Join call and never rejoins by itself.",
    acs: ["034/AC-003", "034/AC-009", "034/AC-010"],
  },
};

const atlas = JSON.parse(readFileSync(FILE, "utf8"));
const list = Array.isArray(atlas) ? atlas : atlas.features;
let changed = 0;
for (const [id, want] of Object.entries(ENTRIES)) {
  const entry = list.find((f) => f.id === id);
  if (!entry) throw new Error(`${id} is not in the atlas; run npm run factory -- compile 034 first`);
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
