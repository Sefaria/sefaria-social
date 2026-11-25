// Names the atlas entries `factory compile 050` created, so each says what it covers.
// Idempotent: a second run prints "already applied".
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../features.json", import.meta.url);
const ENTRIES = {
  "SESS-074": {
    name: "Record on and off during a session, on one clock",
    description:
      "The room's owner, while leading, has one Record control in the room window: Record, then Pause recording and Resume recording any number of times; the MediaRecorder and the state track pause together, so the recording's length is the recorded time.",
    acs: ["050/AC-001"],
    status: "built",
    tests: ["app/src/features/recording/recorder.test.ts", "e2e/session-endings.spec.ts"],
  },
  "SESS-075": {
    name: "Close, Finish and Leave, and the closed room",
    description:
      "The owner ends the session for everyone (Close room, End broadcast or Finish and save, with a confirmation), which finishes a recording and ends a broadcast; everyone is taken out and told the room was closed; anyone else Leaves alone. A closed room starts again for its owner, and a session ends 2 minutes after its owner is gone.",
    acs: ["050/AC-002", "050/AC-003", "050/AC-004", "050/AC-005", "050/AC-007"],
    status: "built",
    tests: ["app/src/features/session/endings.test.tsx", "packages/session/src/room.test.ts", "e2e/session-endings.spec.ts"],
  },
  "ROOM-054": {
    name: "Choose at Start what the session is and whether to record it",
    description:
      "The start dialog offers a room, a broadcast or just me, and Record this session (on by default for a broadcast and for just me); Start begins the session that way.",
    acs: ["050/AC-006"],
    status: "built",
    tests: ["app/src/features/rooms/rooms.test.tsx", "e2e/session-endings.spec.ts"],
  },
};

const atlas = JSON.parse(readFileSync(FILE, "utf8"));
const list = Array.isArray(atlas) ? atlas : atlas.features;
let changed = 0;
for (const [id, want] of Object.entries(ENTRIES)) {
  const entry = list.find((f) => f.id === id);
  if (!entry) throw new Error(`${id} is not in the atlas; run npm run factory -- compile 050 first`);
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
