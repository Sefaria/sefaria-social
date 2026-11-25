// Names the atlas entries `factory compile 051` created, so each says what it covers.
// Idempotent: a second run prints "already applied".
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../features.json", import.meta.url);
const ENTRIES = {
  "SHIUR-002": {
    name: "Only the leader is recorded, with the talking head's place",
    description:
      "A recording mixes only the recording person's microphone and draws only their camera (else the title card); its reader timeline carries a social.overlay slice with whether the camera is on and where the call window, the talking head, is.",
    acs: ["051/AC-001", "051/AC-002", "051/AC-003"],
    status: "built",
    tests: ["app/src/features/recording/recorder.test.ts"],
  },
  "SHIUR-003": {
    name: "A ready recording opens for anyone with its link",
    description:
      "Public endpoints /api/v1/assets/{id}, /state and /media serve a ready recording to anyone, signed out included, with no room id or user id; recordings in progress, failed or unknown are 404; a room's list stays members only.",
    acs: ["051/AC-004"],
    status: "built",
    tests: ["app/src/api.assets.int.test.ts"],
  },
  "SHIUR-004": {
    name: "Recording media in an object store",
    description:
      "Media chunks are kept in an object store (a filesystem store under ASSET_STORE_DIR for now) under recordings/<id>/raw/<seq>, with only their count and the last chunk's hash in Postgres; they go with the recording, its room or its owner. The migration deleted earlier recordings (D12) and dropped the chunk table.",
    acs: ["051/AC-005", "051/AC-006"],
    status: "built",
    tests: ["app/src/api.assets.int.test.ts"],
  },
};

const atlas = JSON.parse(readFileSync(FILE, "utf8"));
const list = Array.isArray(atlas) ? atlas : atlas.features;
let changed = 0;
for (const [id, want] of Object.entries(ENTRIES)) {
  const entry = list.find((f) => f.id === id);
  if (!entry) throw new Error(`${id} is not in the atlas; run npm run factory -- compile 051 first`);
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
