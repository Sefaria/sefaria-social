---
id: "026"
title: Notifications — know when someone follows you, answers you, appreciates you, or a teacher you follow posts
status: approved
features: [FEED-066, FEED-067]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [feed, notifications, api]
risk: high
contract_impact: api-minor
---

## Problem

Follows, replies and reactions only matter if the person on the other end finds out. The roadmap (Area 1) lists notifications
from follows ("new content, a followed teacher goes live, a summary is ready"; basic notifications ship in phase one, tentative
23 Nov). Phase one is in-app only: an "Activity" page (the name Instagram and others use; "Notifications" stays the name of the settings tab
where per-kind choices will live) and an unread count in social's navigation, opening straight to the thing the notification
is about.

## Acceptance criteria

- AC-001 WHEN a viewer follows a profile THE SYSTEM SHALL notify that profile's owner (the person, or each administrator of an
  institution) with kind `follow`; WHEN a viewer replies to a post or reacts to it THE SYSTEM SHALL notify the post's author
  with kind `reply` or `reaction`; WHEN an institution or person posts THE SYSTEM SHALL notify that profile's followers with kind
  `post`. Nobody is notified about their own action, and removing a reaction or a follow does not notify.
- AC-002 WHEN a signed-in viewer calls `GET /api/v1/notifications` THE SYSTEM SHALL answer 200 with `{notifications, unread}`:
  the viewer's latest 50 notifications, newest first, each with its id, kind, actor (profile id and name), the post it is about
  (id and the start of its body) when there is one, its time and whether it is read, and `unread` the number not yet read;
  WHEN the viewer calls `POST /api/v1/notifications/read` THE SYSTEM SHALL mark all of them read and answer 200 with `unread: 0`.
- AC-003 WHEN a signed-in viewer is anywhere in social THE SYSTEM SHALL show an "Activity" link in social's navigation with
  the unread count as a badge when it is above zero (its accessible name includes the number), read again every 60 seconds.
- AC-004 WHEN a viewer opens `/social/notifications` THE SYSTEM SHALL list their notifications as sentences in the interface
  language ("Rabbi Cohen followed you", "Dina replied to your post", "Beit Midrash posted"), unread ones marked with a dot and
  bold text, each linking straight to the post or profile it is about, an empty state when there are none, and mark them all read
  once the page is shown, setting the badge to zero.

## Out of scope

- Push, e-mail and WhatsApp notifications, per-kind settings (the settings tab stays a placeholder for them), "went live"
  notifications for rooms, grouping ("3 people replied").

## Notes for the planner

- Notifications are written in the same transaction as the action (`app/src/server/services/notifications.ts`).
- The nav's unread count is shared and polled every 60 seconds (`app/src/features/notifications/use-unread.ts`). The nav item is
  named "Activity" so the settings tab can keep the name "Notifications" (the harness journey of spec 002 finds it by name).
