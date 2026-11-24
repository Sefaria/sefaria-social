---
id: "032"
title: A live shiur in the feed — share a follow-me link and the post follows the leader
status: proposed
features: [FEED-074, FEED-075]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [feed, post, api]
risk: high
contract_impact: api-minor
---

## Problem

The reader's follow me lets a teacher share what they are learning live: a reader address with `follow=<session id>` that
anyone can open to follow along. In the feed that link is dead text. A post that shares it should show where the session is
now — the leader's current source, in Hebrew and English, changing as they move — and let a learner step straight into the
reader, in the room, following the shiur.

## Acceptance criteria

- AC-001 WHEN a learner posts with a follow-me link (an address whose `follow` parameter is a 43-character session id) in
  the source field or in the words THE SYSTEM SHALL keep the session on the post (`followSessionId`) and, unless the learner
  named a source, take the post's source from the address the link opened on ("/Exodus.3.2" is "Exodus 3:2"). Anything
  that is not shaped like a session id is ignored.
- AC-002 WHEN a viewer asks where a post's session is (`GET /api/v1/posts/{postId}/follow`) THE SYSTEM SHALL answer from the
  reader's follow-me relay's status read (`GET /status/<sessionId>` with the shared secret): whether someone leads, the ref of
  the leader's address, the leader's name, whether their tab is hidden for a moment (still live), and how many are in the room. One answer is reused for every viewer for a few
  seconds, so a busy feed asks the relay about once per session per interval.
- AC-003 WHEN the session has ended, the relay is not configured, or it does not answer in time THE SYSTEM SHALL answer
  `live: false` with nothing else; a missing or deleted post, or one without a session, is 404; without a token, 401.
- AC-004 The post card SHALL show a shared session as a live source: "Live", who is learning and how many, the leader's
  current source with its text, updated while the card is on screen and the tab is visible (no socket), and "Join the
  shiur", which opens the leader's place beside the feed like any source link (contract 1.1 openBeside; a 1.0 reader goes there) with the link's `follow` parameter, so the reader's follow me joins and the text follows the leader in its pane.
  Once the session has ended the card says so, shows the post's own source and offers no join.

## Out of scope

- Following inside the feed without opening the reader (a mini player); recordings of a session after it ends.
- Social's own rooms (`/social/r/...`): they already have live cards (specs 015–018). This spec is for the reader's follow me.
- Who may open a session: a follow-me link is its own capability (whoever has it can join); posting it shares it with the
  post's readers, as pasting it anywhere else would.

## Notes for the planner

- Reader side (Sefaria-Project, `reader-next`): `relay/worker.ts` serves `GET /status/<id>` behind `STATUS_SECRET`
  (`src/lib/session/room-status.ts`): `{live, url, leader, participants}` from the spotlight stream; nothing personal.
- Server: `FOLLOW_RELAY_URL` and `FOLLOW_RELAY_SECRET` (the relay's `STATUS_SECRET`); `services/follow-relay.ts` with a 2 s
  timeout, one retry, a 5 s shared cache, and `ENDED` as the fallback.
- Migration 0003: `posts.follow_session_id` (nullable text). Deleted with the post and with the user's posts.
- `Post.followSessionId` (additive); `GET /api/v1/posts/{postId}/follow` (new). api:breaking passes.
- Card: `features/post/LiveFollow.tsx`, polling every 10 s; the join link is `withFollowParam(commands.href(ref), id)`.
