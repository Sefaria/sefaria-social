---
id: "057"
title: Every profile has an @handle, unique and editable in settings, shown wherever the person shows themselves
status: proposed
features: [IDENT-104, IDENT-105]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [profile, settings, feed, api]
risk: high
contract_impact: api-minor
---

## Problem

The owner wants each profile to have a handle (`@name`): a way for people to show who they are, and a way to invite them to a
room (spec 058). Social has no such thing: a profile is known by its UUID and a display name that need not be unique. The owner
chose a handle that belongs to Social (not Sefaria's profile slug), edited in Social's settings.

## Acceptance criteria

- AC-001 WHEN a person's profile is created, or an existing profile without a handle is read, THE SYSTEM SHALL give it a handle
  made from its name (lower-case Latin letters, digits and `_`; a name with none of those gives `learner`), with a number added
  when that handle is taken; every profile's handle is unique, ignoring case
- AC-002 WHEN a signed-in viewer sends `PATCH /api/v1/profiles/me` with `{handle}` THE SYSTEM SHALL put it in canonical form
  first (Unicode NFKC, lower case, a leading `@` dropped, at most 64 characters read) and then accept it only when it is 3–30
  characters of `a–z`, `0–9` and `_`, starts with a letter, and is not reserved; an invalid handle answers 400
  `profile.handle_invalid`, a handle another profile has answers 409 `profile.handle_taken`, and nothing else changes
- AC-003 THE SYSTEM SHALL include the handle in every profile it answers (`GET /api/v1/profiles/me`, `/profiles/{profileId}`,
  the suggestions) and in each post's author, and `GET /api/v1/profiles/by-handle/{handle}` SHALL answer the profile with that
  handle (canonical form, any case) or 404 `profile.not_found`
- AC-004 WHEN a viewer opens `/social/settings?tab=profile` THE SYSTEM SHALL show a Handle field, labelled above it, with `@`
  before it and the rules under it; Save saves it with the name and bio, and an invalid or taken handle is said next to the
  field, in the interface's language, without losing what was typed
- AC-005 WHEN a profile page or a post's author line is shown THE SYSTEM SHALL show the handle as `@handle` beside the name, as
  text (never as markup), left to right inside a Hebrew interface

## Out of scope

- Mentions in posts, a page address made from the handle (`/social/@handle`), handle history or redirects after a change,
  Sefaria's profile slug (unchanged and unrelated).

## Notes for the planner

- `profiles.handle`: text, nullable until assigned, with a unique index on `lower(handle)`. Existing profiles get theirs when
  first read (as person profiles are created on first use, spec 025); the migration adds the column only.
- Reserved: `admin`, `administrator`, `api`, `help`, `me`, `null`, `root`, `sefaria`, `settings`, `social`, `staff`,
  `support`, `system`, `undefined`.
- A handle is public, like the name; nothing in a by-handle answer is more than a profile answer already gives.
