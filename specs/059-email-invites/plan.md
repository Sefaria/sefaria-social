# Plan: spec 059

## Approach

- `server/services/sefaria-lookup.ts`: the signed POST (10 s), `user_id` or null; not configured → null.
- `server/services/mailer.ts`: Resend's `POST /emails` (10 s), the invite email in English or Hebrew (`text` and escaped `html`).
- `invites.ts`: email entries (only when `RESEND_API_KEY` is set): hash, the 24-hour rule on `email_sha256`, lookup, then a
  notification or an email; the answer is `invited` either way.
- Config: `SEFARIA_LOOKUP_URL`, `SEFARIA_LOOKUP_SECRET`, `RESEND_API_KEY`, `INVITE_EMAIL_FROM`, `ROOM_LINK_ORIGIN`; Helm values
  and the runbook.
- Client: the bar's hint when email is unavailable (from `GET /api/v1/rooms/{roomId}/invites/options`? no: the first answer's
  `unavailable` marks it; the bar also reads `emailInvites` from the room's lobby answer).
- Sefaria-Project PR (base `reader-next`): `sso/user_lookup.py`, the URL, settings, Helm values, tests.

## Tests

`api.email-invites.int.test.ts` with a fake Sefaria and a fake Resend on local ports; the bar's unavailable hint in jsdom.
Django tests for the lookup's signature, sizes and answers.
