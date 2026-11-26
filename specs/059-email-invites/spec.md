---
id: "059"
title: Invite by email from the same bar; a Sefaria user is told in Social, anyone else gets an email with the room's link
status: approved
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

- AC-001 WHEN an invitation's entry is an email address and the account lookup is configured THE SYSTEM SHALL, after answering,
  ask Sefaria (`POST <SEFARIA_LOOKUP_URL>`, the body signed like the deletion webhook) which active account has that address;
  for an account that is not the inviter and not in the room it SHALL add the same `room_invite` notification as a handle does,
  with no email
- AC-002 WHEN no Sefaria account has the address, or the lookup is not configured, THE SYSTEM SHALL, after answering, send one
  email to it through the email provider, in the inviter's interface language, saying who invited them, the room's title and
  its link, with every value escaped; an address is emailed at most once in 24 hours, whatever the room or the inviter
- AC-003 THE SYSTEM SHALL answer every email entry `invited` at once, before any lookup or email, so neither the answer nor its
  time tells the caller who has an account; it SHALL keep no email address, only a hash keyed with a server secret, and SHALL
  remove invitation rows after two days
- AC-004 WHILE no email provider key is set THE SYSTEM SHALL answer every email entry `unavailable` without looking it up, and
  the bar SHALL say that inviting by email is not available here; handles work as before
- AC-005 WHEN the lookup or the provider fails or takes more than 10 seconds THE SYSTEM SHALL log it without the address and
  leave the other entries unaffected; an inviter may invite at most 100 addresses a day, and the hourly limit of spec 058 counts
  email entries too, both counted under one lock per inviter so requests sent together cannot pass them

## Out of scope

- Claiming an invitation when the invitee later signs up (the link is enough: rooms are link-open), bounces and complaints,
  an unsubscribe list, templates in Hebrew (the email is in the inviter's interface language, English or Hebrew).

## Notes for the planner

- Sefaria side, on Sefaria-Project's `reader-next` branch beside the token and the deletion webhook: `POST
/api/social/user-lookup` with `X-Sefaria-Signature: sha256=<HMAC(SOCIAL_LOOKUP_SECRET, raw body)>`, body `{"email": "..."}`
  (at most 1 KB), answers 200 `{"user_id": n}` or 404; unsigned or wrong-signature calls answer 401. It finds the user with
  `get_user(email)`, never `User.objects.get(username=...)` (the username is a hash).
- Provider: Resend (`RESEND_API_KEY`, sender `INVITE_EMAIL_FROM`). The room's link is `<ROOM_LINK_ORIGIN>/social/r/<roomId>`.
- Delivery runs in the server process after the answer; a server stopped in between loses that delivery (the address is still
  counted for the day). A queue on the row (decision 0014) is the next step if that matters.
