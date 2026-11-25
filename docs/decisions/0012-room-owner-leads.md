# 0012. The room's owner is its one leader, through a room relay ticket

- Status: accepted
- Date: 2026-11-25
- Deciders: Akiva Berger (owner, decision D3 in `docs/plans/shiur.md`); built in spec 048

## Context

Decision 0008 let everyone lead because the relay knew the Sefaria token but not room roles: every participant joined with
`isHost: true, canLead: true`, the room gave the spotlight to the first who joined, and anyone could take it with Lead. It named
the way out: a server-issued room ticket the relay can verify. The owner decided that the room's owner leads for the whole
session (D3), and that a follower breaks away only by a clear move (D7).

## Decision

- The social server signs a relay ticket for any member of a room at `POST /api/v1/rooms/{roomId}/ticket`, in the broadcast
  ticket's format (`docs/design/session-recording-and-broadcast.md` 6.2) with role `owner` for the room's owner and `member` for
  anyone else.
- The relay makes a join a host who may lead only with a valid owner ticket for that room and that user. Any other join to an
  ordinary room (member ticket, no ticket, a ticket for another room or user, expired or tampered) is a member who cannot lead.
  Broadcast rooms accept only `host`/`viewer` tickets and ordinary rooms only `owner`/`member`, so one kind never opens the other.
- Holding a room's id still admits anyone signed in, as in 0008; only leading changed.
- The surface asks for the ticket at every connect and offers it; without one it connects as a member.
- Following in a room is sticky: the session client breaks away only when the reader settles in another book or section, or 5 or
  more segments from the followed person (`app/src/features/session/place.ts`). A broadcast's viewer still breaks away on any
  input, with Back to live.

## Consequences

- Supersedes 0008's "Everyone may lead". `hand-raise` and `open` modes stay in the protocol but are not offered in the interface.
- A room whose owner is not present has no leader; members stay where they are until the owner comes.
- An old surface that offers no ticket makes even the owner a member until it updates; the relay and surface ship together.
