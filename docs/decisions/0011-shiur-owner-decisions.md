# 0011. The shiur asset, session endings and following: the owner's decisions

- Status: accepted
- Date: 2026-11-25
- Deciders: Akiva Berger (owner), after walking through recording, rooms and broadcast on the dev deployment and answering
  twelve written questions

## Context

Specs 041–047 built recording, replay, broadcast, room flows and the call window as separate features. The walkthrough showed
that they should produce one thing, that getting in takes too many presses, that following breaks on any click, and that the
only way to end a room was to delete it. The plan that follows from it is `docs/plans/shiur.md`.

## Decision

The sixteen decisions D1–D16 in `docs/plans/shiur.md` section 2 are the owner's and are not re-decided by a spec. In short:

- A room, a broadcast and a solo recording all produce one asset: the reader timeline, audio, video when there was one, and a
  transcript, behind one link that opens for anyone holding it, signed out included (D2, D13, D16).
- Only the leader is recorded, and recording can be turned on and off during a session (D1, D5, D14).
- The leader is the room's owner for the whole session; anyone may follow any person by clicking them; when the leader follows
  someone, the leader's followers go along (D3, D4).
- A follower breaks away only by moving to another section or book, or 5 or more segments away (D7).
- Entering a session joins its call; invitees enter with microphone and camera off (D6).
- A recording is finished, a broadcast is ended, a room is closed by its leader and left by a follower; closing ends it for
  everyone and starts creating the asset (D8, D15).
- A posted room link is an open invitation and shows what is being studied (D9).
- Object storage and ffmpeg in the server image are approved; storage is not a zip; transcription is by Sofer.ai in a language
  the user picks; existing recordings may be deleted (D10, D11, D12, D16).

Everything else in that plan (sections 4–6 where not covered above, and all of section 8) is a proposal until the owner
confirms it or approves the spec that contains it.

## Consequences

- Specs 048–056 implement this. Where they change behaviour agreed in specs 012, 033–047 (the Lead button, the pre-join step,
  the mixed recording of every participant, recordings readable by members only, chunks in Postgres), the new spec says which
  earlier acceptance lines it replaces.
- `docs/design/session-recording-and-broadcast.md` describes the storage and capture this replaces; update it in the PR of
  spec 051.
- The leadership modes `hand-raise` and `open` stay in the protocol but are no longer offered in the interface.
