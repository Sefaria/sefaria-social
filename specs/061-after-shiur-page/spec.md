---
id: "061"
title: Revisit a finished shiur through its texts and transcript
status: proposed
features: [SHIUR-008]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [recording, room-lobby]
risk: normal
contract_impact: none
---

## Problem

The existing recording URL is reached from room archives and feed cards, but only offers playback and a state download. Learners need the text itinerary, a distinct-source bibliography and searchable transcript in the same destination, with clear routes back to Social and the room.

## Acceptance criteria

- AC-001 WHEN a recording manifest is ready THE SYSTEM SHALL show its chronological chapters including repeat visits and a bibliography containing each distinct ref once, using the host to open sources beside Social where supported.
- AC-002 WHEN a ready transcript exists THE SYSTEM SHALL show searchable timestamped excerpts; choosing a timestamp SHALL open the existing player and seek to that time.
- AC-003 WHEN assets are processing, absent, unavailable or failed THE SYSTEM SHALL show an appropriate state, retry pending processing, allow retry after a read error and retain recording navigation and controls.
- AC-004 WHEN a viewer opens the page THE SYSTEM SHALL provide Back to Social and Back to room when associated, preserve owner-only deletion and work in English and Hebrew with keyboard controls.
- AC-005 WHEN an owner successfully finishes recording while closing the room THE SYSTEM SHALL navigate to that recording's existing page; failed finalization SHALL not navigate to a completed recording or close the room.

- AC-006 WHEN a viewer revisits a class THE SYSTEM SHALL provide section navigation, a visual itinerary, a selectable bilingual source excerpt with an open-in-reader link, and distinct empty states for summary, shared margins, chiddushim, open questions and next learning. Selection must update the displayed source without losing the itinerary. The layout must stack on narrow screens and preserve explicit text language and direction.

## Out of scope

New routes, migrations, access-policy changes, full-group audio capture, generation of summaries, annotation editing/persistence, recurring scheduling. Existing assets remain public by link. No sample class data in product UI.

## Design

A native after-class page with an editorial title and metadata header, replay actions, visual ordered text itinerary, bilingual selected-source reading workspace with margins, distinct-source bibliography and transcript search. Include the complete artifact taxonomy: overview, texts and margins, chiddushim, open questions, next learning, recording and transcript. Use reader theme tokens and existing host navigation. Summary, shared annotations, chiddushim, questions and next-learning assets have explicit empty states until saved data exists; do not invent participants, content or save controls.

## Notes for the planner

Use existing asset endpoints, recording route and host navigation. Preserve the leader-only capture and public-by-link access rules. Local review can build from a draft work order; shipping needs human code-owner approval.
