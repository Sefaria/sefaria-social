---
id: "059"
title: Invite by email from the same bar; a Sefaria user is told in Social, anyone else gets an email with the room's link
status: proposed
features: [ROOM-056]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [room-lobby, api]
risk: high
contract_impact: api-minor
---

## Problem

The invite bar (spec 058) takes handles. The owner also wants email addresses: someone with a Sefaria account is told in Social,
like a handle; anyone else gets an email with the room's link. Social does not know anyone's email (the sign-in token carries
none) and cannot send email today.

## Acceptance criteria

- AC-001 WHEN an invitation's entry is an email address and the account lookup is configured THE SYSTEM SHALL ask Sefaria
  (`POST <SEFARIA_LOOKUP_URL>`, the body signed like the deletion webhook) which account has that address; for an account it
  SHALL add the same `room_invite` notification as a handle does, with no email
- AC-002 WHEN no Sefaria account has the address, or the lookup is not configured, THE SYSTEM SHALL send one email to it through
  the email provider, saying who invited them, the room's title and its link, with every value escaped, at most once per room
  and address in 24 hours
- AC-003 THE SYSTEM SHALL answer an email entry `invited` whether or not an account has that address (the answer never tells the
  caller who has an account), and SHALL keep no email address: only its SHA-256, to apply the 24-hour rule
- AC-004 WHILE no email provider key is set THE SYSTEM SHALL answer every email entry `unavailable` without looking it up, and
  the bar SHALL say that inviting by email is not available here; handles work as before
- AC-005 WHEN the lookup or the provider fails or takes more than 10 seconds THE SYSTEM SHALL answer that entry `failed`, the
  others unaffected, and log it without the address

## Out of scope

- Claiming an invitation when the invitee later signs up (the link is enough: rooms are link-open), bounces and complaints,
  an unsubscribe list, templates in Hebrew (the email is in the inviter's interface language, English or Hebrew).

## Notes for the planner

- Sefaria side, on Sefaria-Project's `reader-next` branch beside the token and the deletion webhook: `POST
/api/social/user-lookup` with `X-Sefaria-Signature: sha256=<HMAC(SOCIAL_LOOKUP_SECRET, raw body)>`, body `{"email": "..."}`
  (at most 1 KB), answers 200 `{"user_id": n}` or 404; unsigned or wrong-signature calls answer 401. It finds the user with
  `get_user(email)`, never `User.objects.get(username=...)` (the username is a hash).
- Provider: Resend (`RESEND_API_KEY`, sender `INVITE_EMAIL_FROM`). The room's link is `<ROOM_LINK_ORIGIN>/social/r/<roomId>`.
- The email entry counts toward the caller's 50 invitations an hour (spec 058).
