---
id: "024"
title: Replies and reactions — answer a post, and say "Yasher koach"
status: proposed
features: [FEED-064, FEED-065]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [feed, post, api]
risk: high
contract_impact: api-minor
---

## Problem

A post with no way to answer it is a broadcast, not a conversation (roadmap Area 1: "posts and Torah ideas (with replies)";
"basic reactions in phase one", tentative 23 Nov). Learners need to reply to a post in a short thread under it, and to give a
light signal of appreciation without writing anything. Sefaria's word for that signal is the traditional "Yasher koach"
("more strength to you"), which says what a like says in the language of the beit midrash.

## Acceptance criteria

- AC-001 WHEN a signed-in viewer calls `POST /api/v1/posts/{postId}/replies` with `{body}` (1–1,000 characters after trimming)
  THE SYSTEM SHALL store the reply under the post, authored by the viewer's own profile, and answer 201 with the reply; a reply
  to an unknown or deleted post answers 404 `post.not_found`, an empty or too-long body 400 `request.invalid`. WHEN the reply's
  author calls `DELETE /api/v1/replies/{replyId}` THE SYSTEM SHALL remove it and answer 204; anyone else answers 403
  `reply.forbidden`. The post's reply count (spec 023) counts its replies.
- AC-002 WHEN a signed-in viewer calls `PUT /api/v1/posts/{postId}/reaction` THE SYSTEM SHALL record one reaction of that viewer
  on the post (calling it again changes nothing) and answer 200 with the post's reaction count and `reacted: true`; `DELETE` on
  the same path removes it and answers 200 with `reacted: false`; an unknown post answers 404 `post.not_found`.
- AC-003 WHEN a viewer presses a post's "Yasher koach" button THE SYSTEM SHALL show the new state and count at once (before the
  server answers), restore the previous state and announce the failure if the server refuses, and mark the pressed state with an
  icon change and `aria-pressed`, never with colour alone; the count uses tabular figures so it does not shift.
- AC-004 WHEN a viewer opens `/social/p/$postId` THE SYSTEM SHALL list the post's replies under it, oldest first, each with its
  author, relative time and body, and a reply box with a "Reply" button; a sent reply appears at the end of the list at once and
  the post's reply count goes up; the reply's author sees a "Delete" action on it. In the timeline each post shows its reply
  count as a link to its page.

## Out of scope

- Nested replies (one level only), several reaction kinds, editing a reply, notifying (spec 026 does).

## Notes for the planner

- Replies and reactions live in `app/src/server/services/posts.ts` beside posts; counts are subqueries on the timeline's query.
- The reaction button updates optimistically (`app/src/features/post/ReactionButton.tsx`); replies are listed on the post page.
