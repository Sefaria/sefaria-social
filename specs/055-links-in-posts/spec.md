---
id: "055"
title: Links in posts become links, and a room, broadcast or recording link becomes a card under the post
features: [FEED-074, FEED-075]
status: proposed
owner: "@Sefaria/sefaria-social-owners"
surfaces: [api, post, feed]
risk: high
contract_impact: api-minor
---

## Problem

A room, broadcast or recording link pasted into a post is dead text: nothing in a post is a link, so the people who read it
cannot get to the session it invites them to. The owner decided that a public post of a room link is an open invitation that
shows what is being studied (decision 0011, D9). Plan: `docs/plans/shiur.md` 4.7.

## Acceptance criteria

- AC-001 WHEN a room, broadcast or recording link (`/social/r/<id>`, `/social/b/<id>` or `/social/rec/<id>`, as a path or an
  http(s) URL on a Sefaria origin or the page's own origin) is pasted or typed into the composer THE SYSTEM SHALL take the
  first such link out of the text and show it as a card under the text with a remove button; removing the card SHALL put the
  link back into the text where it was; a second such link SHALL stay plain text (one card per post)
- AC-002 WHEN a post is written with `embed: {kind, id}` (`room`, `broadcast` or `recording`) THE SYSTEM SHALL check that the
  target exists and that the author is in its room (its owner or a member) and answer 201 with the post carrying `embed: {kind, id, title, leader}`; an unknown target, or one in a room the
  author is not in, SHALL be refused with 404 and no post created; a post with an embed may have empty text
- AC-003 WHEN a post has no embed THE SYSTEM SHALL answer it in every API response exactly as before, with no `embed` field
- AC-004 WHEN a post's text contains an http or https URL THE SYSTEM SHALL render it as a link with
  `rel="noopener nofollow"` opening in a new tab; any other scheme (for example `javascript:`) SHALL stay text
- AC-005 WHEN a post has an embed THE SYSTEM SHALL show a card in the post with the target's title, the leader's name and one
  button, Join (room), Watch (broadcast) or Play (recording), that goes to the target's page through the host; a target that
  no longer exists SHALL show "no longer available" and no button

## Out of scope

- Live state on the card (spec 056), more than one card per post, previews of other sites' links, editing a post.
- Whether a signed-out person may open a live room or broadcast (plan section 8); the buttons go to the pages that exist.

## Notes for the planner

- `posts` gains `embed_kind` (`room | broadcast | recording`) and `embed_id` (uuid), both null or both set; no foreign key: a
  target deleted later shows as unavailable. Migration `0007_post_embeds` is expand only.
- Hydrate embeds like quotes (`withQuoted`): one query per kind for title and the leader's name (`user_display` of the room's
  owner, the broadcast's host, the recording's owner).
- `PostInput.embed` optional; `body` may be empty only with an embed. `Post.embed` optional, set only when there is one
  (plan 0: a new always-present field breaks older exact-match tests).
- The composer's link parser is a pure function (`features/post/embed-link.ts`) with the origins it accepts; the card lives in
  `features/post/EmbedCard.tsx` and reuses the feed card's look (`features/feed/card.module.css` tokens). Keep it out of
  `[data-social-page=feed]`.
- Links in text: `features/post/linkify.tsx`, a pure tokeniser, React elements only (never `dangerouslySetInnerHTML`).
