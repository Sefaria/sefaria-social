# Room flows: start, invite, join, find, manage

Status: proposed with spec 044. Owner: @Sefaria/sefaria-social-owners.

## 1. Why

Rooms, calls, recording, replay and broadcast were built API first. A person who opens `/social` today cannot start a room,
cannot find the rooms they are in except through the feed's rail, cannot invite anyone except by copying the address bar, and
cannot rename, delete or leave a room. The server already has every endpoint for these (`POST/GET /rooms`, `PATCH/DELETE
/rooms/{id}`, `POST /rooms/{id}/members`, `DELETE /rooms/{id}/members/me`); only the interface is missing. Spec 044 adds it, so
the whole life of a room can be used, and tested, from the interface alone.

## 2. The journeys

```
              ┌──────────── /social (home) ────────────┐
              │  rail: Your rooms  [Start a room]       │
              │  Live now · Scheduled · Recent · All →  │
              └───────┬───────────────┬─────────────────┘
                      │               │
          Start a room│               │ Rooms (nav) / All rooms
                      ▼               ▼
              ┌─ dialog ─┐     ┌── /social/rooms ──┐
              │ Name it  │     │ every room you're │
              │ [Start]  │     │ in, owner/member  │
              └────┬─────┘     │ [Start a room]    │
                   │           └────────┬──────────┘
                   ▼                    ▼
   ┌──────────────────── /social/r/:id  (lobby) ───────────────────┐
   │ Title · You own this room / You are a member                  │
   │ [Enter the room]  [Join call]          N here · N on a call   │
   │ Invite people: link [Copy] [Share]                            │
   │ Owner tools: [Record]  [Broadcast → link, Copy, End]          │
   │ Who is here · Recordings (→ /social/rec/:id, Back to the room)│
   │ Room settings: Rename · Delete (owner) | Leave room (member)  │
   └───────────────────────────────────────────────────────────────┘
            ▲ invitee opens the link → "Join this room" → member
```

1. **Start.** Signed in, a person presses Start a room (home rail, the rooms page, or an empty state), names it (1 to 120
   characters, required) and lands in the new room's lobby as its owner, with the invitation in view.
2. **Invite.** Every member's lobby shows the room's full link with Copy and the Share menu (spec 027's WhatsApp, e-mail, the
   browser's share sheet). Holding the link is the invitation (spec 011), so there is nothing else to configure.
3. **Join.** Unchanged (spec 011, ROOM-044): the invitee opens the link, presses Join, and becomes a member. Signed out, Join
   asks the reader to sign in.
4. **Find.** A Rooms item in social's navigation opens `/social/rooms`: every room the person is in, newest first, each saying
   whether they own it, each linking to its lobby. The home rail links to it ("All rooms").
5. **Learn together.** Unchanged: Enter the room, Join call, Record, Broadcast (specs 012, 033–043).
6. **Manage.** The owner renames the room in place and can delete it after a confirmation that says its recordings go with it.
   A member can leave it after a confirmation. Both end on the rooms page with a status line saying what happened; a live session
   for that room in this browser is closed first.
7. **Come back.** A recording's page links back to its room.

## 3. Decisions

- **D-RF1 No new endpoints.** Everything uses the existing rooms API, so `contract_impact: none` and no migration.
- **D-RF2 A room stays invite-by-link.** No member list, no removing members, no public rooms: none has an endpoint, and the
  link-as-invitation rule (spec 011) already covers a test of every flow. Listed as follow-ups.
- **D-RF3 The rooms page is its own surface** (`rooms`, `/social/rooms`), so its QA reach is a single route.
- **D-RF4 Starting a room from the reader at the current text** is out of scope: the room has no "text" field; entering an
  empty room keeps the reader where it is (spec 012). A follow-up can add "Start a room here" to the reader's own menus.

## 4. States and copy

| Place | Empty / signed out / error |
|---|---|
| Home rail, no rooms | "You are not in any room yet." + Start a room |
| Rooms page, none | same, with Start a room |
| Rooms page, signed out | "Sign in to see your rooms." + Sign in |
| Start dialog | Start disabled until a name is typed; a failed create keeps the dialog open with "The room could not be created." |
| Rename | Save disabled for an empty name; failure: "The name could not be saved." |
| Delete | "Delete “Title”? Its recordings will be deleted too, and no one will be able to open it." Delete / Cancel |
| Leave | "Leave “Title”? You can come back with its link." Leave / Cancel |
| After delete / leave | Rooms page: "“Title” was deleted." / "You left “Title”." |

## 5. QA surfaces

`factory/surface-map.yaml` gains `rooms` (this spec) and, because PR #30's surface derivation failed on them, `call`
(`features/av`), `recording` (`features/recording`, `features/replay`, `/social/rec`) and `broadcast` (`features/broadcast`,
`/social/b`).
