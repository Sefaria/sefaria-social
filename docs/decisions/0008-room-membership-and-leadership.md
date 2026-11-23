# 0008. Joining by link, everyone may lead, and publishing only from inside the room

- Status: proposed
- Date: 2026-11-23
- Deciders: milestone P3 worker; a human owner confirms by approving the PR

## Context

P3 needs a way into a room for people who are not members yet, a rule for who leads a room's stream, and a rule for when a
viewer's own reader state is published. The plan fixes the lobby as the room's shareable address (R8) and the relay's token
check (6.1), but not these three.

## Decision

- **The room id is the invitation.** Room ids are random UUIDs (`gen_random_uuid()`), so a link is unguessable. Any signed-in
  user who has one may `POST /api/v1/rooms/{roomId}/members`. A non-member still gets 404 from `GET /api/v1/rooms/{id}`, so the
  lobby shows Join without the room's title. The relay does not check membership: holding the id is the same right.
- **Everyone may lead.** The relay knows the Sefaria token, not room roles, so every participant joins with `isHost: true,
canLead: true`. The reader's room then gives the spotlight to the first who joins and lets anyone move it (Lead). Owners
  as the only hosts would need a server-issued room ticket the relay can verify, or a relay call to the server; that is on
  the setup checklist as an owner decision.
- **Publish only from inside the room's context.** The session client publishes only while the viewer is in that room's
  reader context (`canPublish`), and `/social` pages are private in the outgoing view, so a lobby, a settings page or a
  minimised viewer's wanderings never reach followers. A follower who enters before anyone publishes lands in the library
  (`/texts`) and follows the spotlight from there.
- **Presence "following" is the stream taken, not the screen.** In the lobby the client already follows the spotlight (so
  Enter can apply its state at once, R9), and presence says so; nothing is applied until the viewer enters.

## Consequences

- A leaked link admits anyone signed in, until owners can remove members (not built).
- A viewer idle in a lobby can hold the spotlight while publishing nothing; followers then stay where they are. Lead moves it.
