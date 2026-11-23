---
id: "025"
title: Profiles and follows — people and institutions, a page for each, and one-tap follow
status: proposed
features: [IDENT-100, IDENT-101, IDENT-102, IDENT-103]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [feed, profile, settings, api]
risk: high
contract_impact: api-minor
---

## Problem

The timeline (spec 023) is only as good as whom it follows. The roadmap (Area 1 and Area 5) asks for one-tap follow of a
teacher, a learner or an entity — a shul, a yeshiva, an institution, a community — with a basic follow feature in phase one,
and for profiles that can belong to an entity, not only a person. Newcomers come in through community, not the library, so the
first screen must suggest whom to follow rather than leave them in front of an empty timeline.

## Acceptance criteria

- AC-001 WHEN a signed-in viewer calls `GET /api/v1/profiles/me` THE SYSTEM SHALL answer 200 with the viewer's person profile
  (id, kind `person`, name, bio, follower and following counts, and the institution profiles the viewer administers), creating
  it on first use with the name from the viewer's token; `PATCH /api/v1/profiles/me` with `{name?, bio?}` (name 1–80, bio 0–300
  characters) updates it and answers 200.
- AC-002 WHEN a signed-in viewer calls `GET /api/v1/profiles/{profileId}` THE SYSTEM SHALL answer 200 with the profile (id, kind
  `person` or `institution`, name, bio, follower and following counts, whether the viewer follows it, and whether it is the
  viewer's own or one they administer) and its latest posts (the post shape of spec 023); an unknown profile answers 404
  `profile.not_found`.
- AC-003 WHEN a signed-in viewer calls `PUT /api/v1/profiles/{profileId}/follow` THE SYSTEM SHALL record that the viewer follows
  that profile (idempotent) and answer 200 with `{following: true, followers}`; `DELETE` on the same path stops following and
  answers `{following: false, followers}`; following one's own person profile answers 400 `follow.self`; an unknown profile 404.
- AC-004 WHEN a signed-in viewer calls `GET /api/v1/profiles?suggested=1` THE SYSTEM SHALL answer 200 with up to 6 profiles the
  viewer does not follow and that are not their own, institutions first, then the people with the most followers.
- AC-005 WHEN a viewer opens `/social/u/$profileId` THE SYSTEM SHALL show the profile's name, a kind label for an institution,
  its bio, follower and following counts, a "Follow"/"Following" button (none on one's own profile, which links to editing it in
  settings instead) and its posts; pressing Follow changes the button and the count at once. The feed's rail shows "Who to
  follow" with the suggested profiles and the same button; author names in the timeline link to their profiles.
- AC-006 WHEN a viewer opens `/social/settings?tab=profile` THE SYSTEM SHALL show a form with their name and bio, the bio's
  remaining characters, and a "Save" button that saves them and says it did; the composer (spec 023) offers "Post as" with the
  viewer's own profile and each institution they administer.

## Out of scope

- Creating institution profiles from the interface (they are created by staff or the demo seed), avatars and images, blocking
  and muting, follower lists, private profiles.

## Notes for the planner

- A person's profile is created lazily (`app/src/server/services/person-profile.ts`), shared by posts and profiles so neither
  service imports the other. Institutions and their administrators come from SQL (staff) or the demo seed (spec 028).
- The viewer's own profile is read once and shared (`app/src/features/profile/use-me.ts`) by the nav, the composer and settings.
