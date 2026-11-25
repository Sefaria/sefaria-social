# Plan: spec 048

## Approach

1. **Sticky following (T-001).** The session client (`packages/session/src/client.ts`) gains `drifted(mine, theirs)` and
   `settleMs`. Input no longer pauses at once: it arms a 400 ms timer, reset by further input or local changes; when it fires
   and the client is still live, the client compares its own snapshot with the followed stream's folded `current()` and breaks
   away only when `drifted` says so. Social's comparator (`features/session/place.ts`) reads each snapshot's place: the first
   panel's anchor in `sefaria.scroll` (a segment ref), else `social.summary`'s ref, else the path. Different book or section, or
   5 or more segments apart, is drifted. `sessions.ts` passes it for every room.
2. **Room tickets (T-002).** The ticket format of spec 043 gains roles `owner` and `member` for ordinary rooms. The server signs
   one for any member at `POST /api/v1/rooms/{roomId}/ticket` (404 otherwise). The relay reads an optional ticket on an ordinary
   room: a valid owner ticket for that room and user makes the join a host who may lead; anything else makes it a member who
   cannot. Broadcast rooms accept only `host`/`viewer`, ordinary rooms only `owner`/`member`. `sessions.ts` asks for the ticket at
   every connect (through the rooms API) and offers it; a failed request connects without one (a member).
3. **Interface (T-003).** The room window drops Lead; a leader who follows someone gets Lead again (`follow(null)`). Clicking a
   person in who is here or a call tile follows them (tile identities `u:<id>` map to `<id>`); clicking the one you follow, or
   the leader, returns to the leader. The client passes on a move it took from a followed stream as a keyframe (trailing 150 ms,
   never the same snapshot twice) when someone needs its stream.

## Tests that prove each AC (and why they fail on the base)

| AC      | Test                                                                        | Fails on base because             |
| ------- | --------------------------------------------------------------------------- | --------------------------------- |
| 001–003 | `client.test.ts`, "spec 048" block, with a test comparator                  | any input pauses at once          |
| 004     | `api.rooms.int.test.ts`: ticket for owner, member, stranger                 | the route does not exist (404)    |
| 005     | `relay.test.ts`: joins with owner, member, none, tampered tickets           | every join is a host              |
| 006     | `room-window.test.tsx`: no Lead button                                      | the window offers Lead            |
| 007     | `room-window.test.tsx`: Lead again; `Tiles.test.tsx`: tile click follows    | neither exists                    |
| 008     | `client.test.ts`: a leader following someone sends a keyframe; no echo loop | applied moves are never published |

## Risks

- Relay and surface deploy separately: an old surface without tickets makes even the owner a member until it updates. Both
  ship from one release; the e2e suite runs them together.
- `place.ts` reads reader slices by name; if reader-next renames `sefaria.scroll`, the comparator falls back to the summary's
  ref, then the path, which is coarser but never breaks following by mistake on a click.
