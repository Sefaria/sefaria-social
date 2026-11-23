---
id: "014"
title: Following someone in a room through the reader state API, proven with two learners
status: approved
features: [SESS-014, SESS-050]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [room, persistent]
risk: high
contract_impact: none
---

## Problem

Inside a room's context the viewer's reader follows someone: by default whoever leads (the spotlight), or a person the
viewer picks. Following happens only through the reader state API (`applySnapshot` with origin `follow`), never by writing
the address. The viewer can break away by moving themselves, and come back with one press. Milestone P3's exit test is the
whole thing end to end: two browser contexts in one room, one moves and the other's reader follows, a refresh on the `ctx`
address reconnects, Back leaves, and the follower's own settings are untouched.

## Acceptance criteria

- AC-001 WHEN the viewer is in a room's context and following THE SYSTEM SHALL apply the followed person's moves through
  `host.reader.state.applySnapshot` with origin `follow`: the spotlight holder by default, or the participant the viewer
  picked with Follow in the presence list.
- AC-002 WHEN the viewer moves in the reader themselves while following THE SYSTEM SHALL stop applying, say they are on
  their own with a "Follow again" button, and pressing it applies the followed person's current place at once and goes
  on following.
- AC-003 WHEN the viewer presses Lead in the room's context THE SYSTEM SHALL ask the room for the spotlight, and while they
  hold it their moves are published to those who follow.
- AC-004 WHEN two viewers are in one room on the harness (local relay, local server, real Postgres) and the leader moves
  THE SYSTEM SHALL move the follower's reader to the same place; a refresh of the follower's `ctx` address reconnects and
  keeps following; Back takes the follower out of the room; and the follower's own `sefaria.settings` slice is unchanged.

## Out of scope

- Hand-raise and presenter modes in the UI (the room supports them; no buttons yet), chat.
- The same journeys against the real reader (L4b): written in `e2e/reader/`, disabled until the reader seam (A1) merges.

## Notes for the planner

- The relay and server for e2e: `e2e/stack/` starts a JWKS server with a key generated per run, the Start server
  (`dist/server/server.js`) on Postgres, and the relay with `wrangler dev`; tokens are minted by the test (persona tokens)
  and handed to the harness's fake host.
- The harness's fake reader gets controls to move (a reader navigation that keeps `ctx`, like the reader's own) so the
  tests can act as a learner.
