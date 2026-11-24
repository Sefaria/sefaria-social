---
id: "023"
title: Posts and the timeline — share a Torah thought, anchored to a source, and read what the people you follow share
status: approved
features: [FEED-060, FEED-061, FEED-062, FEED-063]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [feed, post, api]
risk: high
contract_impact: api-minor
---

## Problem

The feed today shows only rooms: what is live, scheduled and recent (spec 015). The Labs roadmap (Area 1, reviewed 23 Nov)
asks for the basic social asset first: a post, a short Torah thought a learner writes, ideally anchored to the source it is
about, so the feed pulls toward the text rather than away from it. A learner needs to write one in a few seconds, see it in a
timeline beside what the people and institutions they follow have shared, open it on its own page with a link that can be
shared, and remove it if they change their mind. Posting is "creating Torah": the composer must feel like an invitation, not a
form.

## Acceptance criteria

- AC-001 WHEN a signed-in viewer calls `POST /api/v1/posts` with `{body}` (1–2,000 characters after trimming), optionally
  `ref` (a source citation such as "Genesis 1:1", at most 200 characters) and optionally `asProfileId` (an institution profile
  the viewer administers, spec 025) THE SYSTEM SHALL store the post with its author profile (the viewer's own profile when
  `asProfileId` is absent) and answer 201 with the post as the timeline shows it; an empty or too-long body or ref answers 400
  `request.invalid`, and an `asProfileId` the viewer does not administer answers 403 `post.forbidden`.
- AC-002 WHEN a signed-in viewer calls `GET /api/v1/timeline?tab=following` THE SYSTEM SHALL answer 200 with `{posts,
nextCursor}`: the posts of the profiles the viewer follows and of the viewer's own profile, newest first, at most 20 per page,
  each with its id, body, ref, author (profile id, kind, name), created time, reply count, reaction count and whether the
  viewer has reacted; `tab=everyone` answers the same shape for all posts; `before=<cursor>` returns the next older page and
  `nextCursor` is null on the last page; deleted posts never appear.
- AC-003 WHEN a signed-in viewer calls `GET /api/v1/posts/{postId}` THE SYSTEM SHALL answer 200 with the post and its replies
  (spec 024), oldest reply first; an unknown or deleted post answers 404 `post.not_found`. WHEN the post's author (or an
  administrator of its institution profile) calls `DELETE /api/v1/posts/{postId}` THE SYSTEM SHALL mark it deleted and answer
  204; anyone else answers 403 `post.forbidden`.
- AC-004 WHEN a signed-in viewer opens `/social` THE SYSTEM SHALL show, beside the rooms of spec 015, a composer and a timeline
  with two tabs, "Following" (the default) and "Everyone": the composer has a text area with a placeholder that invites a Torah
  thought, an optional source field that is pre-filled with the reader's current source when there is one, a character count
  that turns to a warning near the limit, and one primary "Post" button disabled while the text is empty; a new post appears at
  the top of the timeline at once; the timeline loads older posts with a "Show more" button, shows skeleton rows while loading,
  and an empty state with an invitation to follow people or post when there is nothing to show.
- AC-005 WHEN a post has a source THE SYSTEM SHALL show the source's citation as a link that opens it in the reader
  (`host.navigate`, R15) and the source's opening text beneath the post body (the source-text renderer of spec 017); WHEN a
  viewer opens `/social/p/$postId` THE SYSTEM SHALL show that post on its own page with its author, time, body, source and
  actions, an author's "Delete" action that asks for confirmation first, and social's not-found page for an unknown id.
- AC-006 Every string the timeline, composer and post page add is in the interface language with matching `lang` and `dir`;
  post bodies keep their own direction (`dir="auto"`); times are relative ("5 min", "2 h", "3 Nov") in the interface language
  with the full date in the `<time>` element's `datetime` and title; every control is reachable by keyboard with a visible focus
  ring, and the timeline is a list of `<article>` elements.

## Out of scope

- Media uploads and rich embeds, editing a post, drafts, mentions and hashtags, ranking (the timeline is time-ordered).

## Notes for the planner

- Sefaria's look: white paper, ink-blue (`--sefaria-color-brand`) for the one primary action per view, serif
  (`--sefaria-font-text-*`) for what people wrote and for sources, sans for the interface; no card inside a card; separate posts
  with a 1px divider, not a border and a shadow together; a reading column of about 600px; motion 150–200ms, none with
  `prefers-reduced-motion`.
- Layout: a two-column page on wide screens (timeline column, rooms rail of about 300px); one column on phones with the rooms
  rail collapsed above the timeline.
