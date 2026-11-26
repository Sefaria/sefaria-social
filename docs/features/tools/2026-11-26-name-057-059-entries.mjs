// Names the atlas entries `factory compile 057`, `058` and `059` created, so each says what it covers.
// Idempotent: a second run prints "already applied".
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../features.json", import.meta.url);
const ENTRIES = {
  "IDENT-104": {
    name: "Profile @handles, unique and made from the name",
    description:
      "Every profile has an @handle, unique ignoring case: the database gives a new profile one made from its name (a number added on a clash; 'learner' for a name without Latin letters); PATCH /profiles/me changes it after canonical form (NFKC, lower case, no '@'), refusing invalid, reserved or taken ones; profiles and post authors carry it; GET /profiles/by-handle/{handle} finds one.",
    acs: ["057/AC-001", "057/AC-002", "057/AC-003"],
    status: "built",
    tests: ["app/src/api.handles.int.test.ts"],
  },
  "IDENT-105": {
    name: "The @handle in settings and beside the name",
    description:
      "Settings' profile tab has a Handle field (label above, '@' before it, the rules under it); a taken or invalid handle is said under the field and the text stays; the profile page and each post show @handle beside the name.",
    acs: ["057/AC-004", "057/AC-005"],
    status: "built",
    tests: ["app/src/features/profile/profile-handle.test.tsx", "e2e/social.spec.ts"],
  },
  "ROOM-055": {
    name: "The invite bar in a room, and invitations in activity",
    description:
      "Under Invite people in the room's lobby, a field takes @handles (with suggestions) and emails as chips and sends them; each comes back with what happened; an invited person sees 'X invited you to <room>' with Join in their activity.",
    acs: ["058/AC-002", "058/AC-005"],
    status: "built",
    tests: [
      "app/src/api.invites.int.test.ts",
      "app/src/features/room/invite-bar.test.tsx",
      "app/src/features/notifications/sentence.test.ts",
      "e2e/rooms.spec.ts",
    ],
  },
  "API-052": {
    name: "Room invitations and people search",
    description:
      "POST /rooms/{roomId}/invites (members only, 1–20 entries, an answer per entry, once per person and room a day, 50 an hour per inviter); GET /people?q= (up to 8 person profiles by handle prefix or name, public fields only).",
    acs: ["058/AC-001", "058/AC-003", "058/AC-004"],
    status: "built",
    tests: ["app/src/api.invites.int.test.ts"],
  },
  "ROOM-056": {
    name: "Inviting by email",
    description:
      "An email in the invite bar: a Sefaria account (looked up on Sefaria, signed request) gets the in-app invitation; anyone else an email with the room's link; the answer never says which, and no address is kept.",
    status: "planned",
  },
};

const atlas = JSON.parse(readFileSync(FILE, "utf8"));
const list = Array.isArray(atlas) ? atlas : atlas.features;
let changed = 0;
for (const [id, want] of Object.entries(ENTRIES)) {
  const entry = list.find((f) => f.id === id);
  if (!entry) throw new Error(`${id} is not in the atlas; run npm run factory -- compile first`);
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
