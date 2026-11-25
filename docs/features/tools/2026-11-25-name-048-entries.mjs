// Names the atlas entries `factory compile 048` created, so each says what it covers.
// Idempotent: a second run prints "already applied".
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../features.json", import.meta.url);
const ENTRIES = {
  "SESS-070": {
    name: "Sticky following: break away only by a clear move",
    description:
      "Input alone never pauses a follower: once the reader is still for 400 ms its place is compared with the followed person's, and only another book or section, or 5 or more segments away, sets them on their own.",
    acs: ["048/AC-001", "048/AC-002", "048/AC-003"],
    status: "built",
    tests: ["packages/session/src/client.test.ts", "app/src/features/session/place.test.ts", "e2e/room-window.spec.ts"],
  },
  "SESS-071": {
    name: "The room's owner is its one leader",
    description:
      "The server signs a room relay ticket naming the caller as owner or member; the relay makes only an owner ticket a host who may lead, so members cannot take the spotlight, and the room window offers no Lead button.",
    acs: ["048/AC-004", "048/AC-005", "048/AC-006"],
    status: "built",
    tests: [
      "app/src/api.room-tickets.int.test.ts",
      "packages/relay/src/relay.test.ts",
      "app/src/features/session/room-window.test.tsx",
    ],
  },
  "SESS-072": {
    name: "Follow a person by clicking them; the leader takes followers along",
    description:
      "Clicking a person in who is here or on their call tile follows them, clicking again returns to the leader, a leader who follows someone gets Lead again, and moves the leader takes from someone they follow reach the leader's followers.",
    acs: ["048/AC-007", "048/AC-008"],
    status: "built",
    tests: [
      "app/src/surface/room-following.test.tsx",
      "app/src/features/av/Tiles.test.tsx",
      "packages/session/src/client.test.ts",
    ],
  },
};

const atlas = JSON.parse(readFileSync(FILE, "utf8"));
const list = Array.isArray(atlas) ? atlas : atlas.features;
let changed = 0;
for (const [id, want] of Object.entries(ENTRIES)) {
  const entry = list.find((f) => f.id === id);
  if (!entry) throw new Error(`${id} is not in the atlas; run npm run factory -- compile 048 first`);
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
