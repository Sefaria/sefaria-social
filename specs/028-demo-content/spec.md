---
id: "028"
title: Demo content — a seeded beit midrash so the feed is alive on the first visit
status: proposed
features: [OPS-093]
owner: "@Sefaria/sefaria-social-owners"
surfaces: []
risk: high
contract_impact: none
---

## Problem

The roadmap's go-to-market note: launch with teachers who already have audiences, so the feed is not empty. For the demo in five
weeks, and for every preview and QA run until then, a fresh deployment needs a believable community: a few institutions and
teachers, posts anchored to well-known sources, replies, reactions and follows. The QA seed (spec 082) already loads named
scenarios idempotently; this adds one.

## Acceptance criteria

- AC-001 WHEN `npm run qa:seed -- demo` runs THE SYSTEM SHALL create, by stable ids, at least 3 institution profiles, 4 person
  profiles (invented people; no personal data), 12 posts across Tanakh, Talmud and liturgy with sources, replies, reactions,
  follows between them and administrators for the institutions, so that a persona who follows the institutions sees a full
  Following tab; running it a second time creates nothing new.
- AC-002 WHEN `npm run qa:seed -- demo --for <userId>` runs THE SYSTEM SHALL also make that user follow the demo institutions
  and administer one of them, so a real reader account opening the feed sees a full timeline and can post as the institution.

## Out of scope

- Seeding production, seeding rooms and shiurim (existing scenarios do).

## Notes for the planner

- The QA seed (`app/src/server/db/qa-seed.ts`) gains profiles, administrators, follows, posts, replies, reactions and notifications,
  each with stable ids and "on conflict do nothing"; `joinScenario` adds a real account. Times are minutes before seeding.
