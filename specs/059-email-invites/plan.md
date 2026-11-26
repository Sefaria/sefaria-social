# Plan: spec 059

## Approach

- `server/services/sefaria-lookup.ts`: the signed POST (10 s), `user_id` or null; not configured → null.
- `server/services/mailer.ts`: Resend's `POST /emails` (10 s), the invite email in English or Hebrew (`text` and escaped `html`).
- `email-invites.ts` (installed into `invites.ts`): email entries, after the handles' transaction and in parallel, only
  when `RESEND_API_KEY` is set: hash, the 24-hour rule on `email_sha256`, lookup, then a notification or an email; the answer
  is `invited` either way.
- Config: `SEFARIA_LOOKUP_URL`, `SEFARIA_LOOKUP_SECRET`, `RESEND_API_KEY`, `INVITE_EMAIL_FROM`, `ROOM_LINK_ORIGIN`; Helm values
  and the runbook.
- Client: when an answer says `unavailable`, the bar says inviting by email is not available here; the bar sends the
  interface language (`lang`) for the email.
- Sefaria-Project PR (base `reader-next`): `sso/user_lookup.py`, the URL, settings, Helm values, tests.

## Tests

`api.email-invites.int.test.ts` with a fake Sefaria and a fake Resend on local ports; the bar's unavailable hint in jsdom.
Django tests for the lookup's signature, sizes and answers.
