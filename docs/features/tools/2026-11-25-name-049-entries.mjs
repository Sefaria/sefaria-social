// Names the atlas entries `factory compile 049` created, so each says what it covers.
// Idempotent: a second run prints "already applied".
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../features.json", import.meta.url);
const ENTRIES = {
  "ROOM-052": {
    name: "Start a room and land in it, in its call",
    description:
      "Naming a room and pressing Start takes the starter straight into the room's reader context (the library from a Social page) and its call with their last microphone and camera choice; no lobby, Enter or pre-join step.",
    acs: ["049/AC-001"],
    status: "built",
    tests: ["app/src/features/rooms/rooms.test.tsx", "e2e/room-flows.spec.ts"],
  },
  "ROOM-053": {
    name: "One Join takes an invitee into the room and its call",
    description:
      "An invitee's one Join makes them a member, takes them to the leader's place and into the call with microphone and camera off; signed out, it carries on after sign-in; Enter the room also joins the call; without calls nothing else changes.",
    acs: ["049/AC-002", "049/AC-003", "049/AC-004", "049/AC-005"],
    status: "built",
    tests: ["app/src/features/room/RoomLobbyPage.test.tsx", "e2e/room-flows.spec.ts", "e2e/rooms.spec.ts"],
  },
  "SESS-073": {
    name: "Entering a room joins its call; the owner's choice is remembered",
    description:
      "The call controller enters a room's call straight through the pre-join step; the room owner's microphone and camera choices are kept in this browser for the next room (first time: microphone on, camera off); invitees start with both off.",
    acs: ["049/AC-006"],
    status: "built",
    tests: ["app/src/features/av/call-controller.test.ts"],
  },
};

const atlas = JSON.parse(readFileSync(FILE, "utf8"));
const list = Array.isArray(atlas) ? atlas : atlas.features;
let changed = 0;
for (const [id, want] of Object.entries(ENTRIES)) {
  const entry = list.find((f) => f.id === id);
  if (!entry) throw new Error(`${id} is not in the atlas; run npm run factory -- compile 049 first`);
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
