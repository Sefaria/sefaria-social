---
id: "045"
title: You stay in a room while you read around, in a room window that looks and works like part of Sefaria
status: approved
features: [SESS-067, SESS-068, ROOM-051]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [session, room-lobby]
risk: normal
contract_impact: none
---

## Problem

Trying a room on the cauldron showed three problems. Following any link in the reader (a category, a book) drops
`ctx=social.room.<id>` from the address, and Social treats that as leaving: the room's bar disappears and nobody follows the
leader any more. Being in a room should feel like being in a call — it stays with you until you Minimise or Leave. The bar
itself is unstyled text and browser-default buttons in the reader's corner, over the reader's Ask button. And when a server
does not offer calls, the lobby simply shows no Join call, so a tester cannot tell calls are off rather than broken.

## Acceptance criteria

- AC-001 WHILE the viewer is in a room's context (entered, not minimised or leaving), WHEN the reader goes to another reader page
  without `ctx` (a link in the reader, a search result, the address bar within the app) THE SYSTEM SHALL put the room's `ctx` back
  on that address with a replace, keeping the viewer in the room (the session, the bar, publishing when they lead); Back to the
  page they entered from, a Social page (`/social/...`) or another room's address SHALL still leave this room's context, as
  spec 013 AC-002 and R10 say
- AC-002 WHEN a follower follows a link in the reader THE SYSTEM SHALL keep them in the room on their own ("You are on your own"
  with Follow again), and Follow again SHALL bring them back to the leader's place
- AC-003 WHILE the reader is in a room's context THE SYSTEM SHALL show the room window: a card fixed at the bottom inline-start
  corner (clear of the reader's own controls at the inline-end corner and of its chrome insets) with a live dot and the room's
  title, the status line, the one action that fits it (Follow again, or Lead), Join call when the server offers calls, the room's
  page and Minimise, and who is here as a count with an expandable list carrying Follow buttons
- AC-004 WHEN the viewer collapses the room window THE SYSTEM SHALL show it as a small pill with the live dot, the room's title and
  the status, expandable again with one press; the choice SHALL last for the browser session; the toggle SHALL be a button with
  `aria-expanded`, and the window a labelled region
- AC-005 WHILE the viewer has a live room they are not in the context of THE SYSTEM SHALL show the same card, compact, with the
  room's title, "Return to the room" (Enlarge) and Leave
- AC-006 WHEN a member opens a room's lobby on a server that does not offer calls THE SYSTEM SHALL say "Video calls are not
  turned on here." where Join call would be

## Out of scope

- Turning calls on (a deployment setting), the call window's own design (spec 035), the reader's own links (they stay as they are;
  the surface restores the context).

## Notes for the planner

- `features/session/controller.ts` `onContext`: before `contextLost`, if the view is expanded or detached, the new address is not
  a Social page and not the stored own place, re-navigate to `withCtx(location, room)` with `{ replace: true }` and return.
- The room window replaces `FollowBar` and `MiniView`'s markup and keeps their data attributes and actions, so the follow tests
  keep reading the same things. The room's title comes from the rooms API (`getRoom`), cached per room.
