---
id: "030"
title: Repost and quote — share a post as it is, or with your own words on top
status: proposed
features: [FEED-070, FEED-071]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [feed, post]
risk: high
contract_impact: none
---

## Problem

A learner who finds a post worth passing on can only say Yasher koach or reply. There is no way to put a teacher's thought in
front of one's own followers, and no way to add "here is how this sits next to the Ramban" while keeping the original attached.
X's two sharing actions fit: a repost (the post, unchanged, to my followers) and a quote (my post, carrying theirs).

## Acceptance criteria

- AC-001 WHEN a learner reposts a post THE SYSTEM SHALL record one repost per profile per post (repeating it changes nothing),
  answer with the viewer's state and the post's repost count, and undo it on request; a missing or deleted post is 404. Every
  post the API returns carries `repostCount`, `quoteCount` and whether the viewer has reposted it.
- AC-002 WHEN a learner posts with `quotedPostId` THE SYSTEM SHALL store a post of theirs that carries the quoted one; the API
  returns it with `quoted` (the quoted post's author, words, source and time) and the quoted post's `quoteCount` grows. A
  quote of a post that is later deleted keeps `quoted.id` with its other fields null; quoting a missing post is 404.
- AC-003 WHILE the viewer follows a profile THE SYSTEM SHALL put that profile's reposts in the viewer's Following tab at the
  time of the repost, with `repostedBy` naming who reposted it; a post shows once per page, at its latest entry.
- AC-004 The post card SHALL show a repost button (pressed state, count, undone on a second press, restored if the server
  refuses), a quote button that opens a short form under the post and posts the quote, the quoted post set inside a quote
  (linking to its page; "This post was deleted" once it is gone), and "<name> reposted" (or "You reposted") above a post a
  repost brought.
- AC-005 The demo community (spec 028) SHALL include reposts and quotes, so the first visit shows both.

## Out of scope

- Notifications for reposts and quotes: the notification `kind` is a response enum, and widening it is a breaking API change
  (api:breaking); it needs its own spec with a client that tolerates unknown kinds first.
- Reposting as an institution; quote threads (a quote of a quote shows only one level).

## Notes for the planner

- Migration 0002: `reposts (post_id, profile_id, created_by_user_id, created_at)` and `posts.quoted_post_id` (on delete set
  null). The user-deleted webhook removes a user's reposts.
- `PUT|DELETE /api/v1/posts/{postId}/repost`; `PostInput.quotedPostId`; `Post` gains `repostCount`, `quoteCount`, `reposted`,
  `quoted`, `repostedBy` (additive; api:breaking passes).
