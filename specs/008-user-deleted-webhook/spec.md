---
id: "008"
title: Account deletion in Sefaria removes the user's social data
status: proposed
features: [IDENT-008]
owner: "@Sefaria/sefaria-social-owners"
surfaces: []
risk: high
contract_impact: api-minor
---

## Problem

When someone deletes their Sefaria account, Django removes its own data but nothing outside Django is told (plan section
6.3). Social stores rooms, memberships, shiurim, recordings (a reading history, so personal data) and a display-name cache
keyed by the Sefaria user id. Django now sends a signed `user.deleted` webhook (Sefaria-Project PR #4121); social must
verify it, delete every row for that user exactly once even when the webhook is retried, keep a tombstone so a still-valid
token cannot recreate data, and offer staff a command for a webhook that was lost. A test must prove that no table is
forgotten, including tables added later.

## Acceptance criteria

- AC-001 WHEN `POST /api/v1/internal/user-deleted` arrives without an `X-Sefaria-Signature` header equal to `sha256=`
  followed by the lowercase hex HMAC-SHA256 of the raw request body keyed with `USER_DELETED_WEBHOOK_SECRET`, THE SYSTEM
  SHALL respond 401 with `webhook.bad_signature` and change nothing.
- AC-002 WHEN a correctly signed `user.deleted` event for user U arrives THE SYSTEM SHALL, in one transaction, delete U's
  memberships, the rooms U owns (with their memberships), the shiurim U teaches, the recordings U owns and U's display
  cache entry, record a tombstone (user id, time, event id) and the event id as received, and respond 200 with
  `{"status":"processed"}`; a test seeds every table with rows for U and for another user, walks the database schema, and
  finds no value equal to U's id in any column of any table except the tombstone, while the other user's rows remain.
- AC-003 WHEN an event id that was already received arrives again THE SYSTEM SHALL respond 200 with
  `{"status":"duplicate"}` and change nothing.
- AC-004 WHEN a user with a tombstone calls a protected route with an otherwise valid token THE SYSTEM SHALL respond 401
  with `auth.user_deleted` and not run the handler.
- AC-005 WHEN staff run `npm run purge-user -- <userId>` with the server's database configuration THE SYSTEM SHALL delete
  that user's data and write the tombstone exactly as the webhook does, and print how many rows it removed per table.
- AC-006 WHEN a correctly signed event of another type arrives THE SYSTEM SHALL respond 200 with `{"status":"ignored"}`,
  record the event id, and change no user data.

## Out of scope

- Telling the relay to drop the user's live connections (the relay arrives in P3; that spec adds the call).
- Chat messages (no chat table yet; its spec must extend the deletion and the seed, which the walk-the-schema test enforces).
- Deleting stored recording blobs (only the pointer row exists in P2).
- Retention of `webhook_receipts` (it holds no personal data; a cleanup job is a later ops task).

## Notes for the planner

- Contract from Django (A2): `POST <social origin>/api/v1/internal/user-deleted`, `Content-Type: application/json`,
  `X-Sefaria-Signature: sha256=<hex>`, `X-Sefaria-Event-Id: <id>`, body exactly
  `{"event":"user.deleted","id":"<uuid4>","occurred_at":"2026-11-23T01:02:03Z","user_id":12345}` (compact, keys sorted).
  Verify over the raw bytes before parsing, constant-time compare. Retries reuse the same id and bytes; 4xx is final.
  Test vector: secret `secret`, body `{"event":"user.deleted","id":"x","occurred_at":"2026-11-23T01:02:03Z","user_id":42}`
  gives `sha256=5a26b7ac2ff4e75aeec9a4dfa56aab52601ce60bb5435b0b44ac82515678a165`.
- No timestamp window (Django retries for about 30 minutes); the event id is the replay guard.
- The route is not public: its credential is the signature, so the route-enumeration test (spec 006) sees 401 without it.
- One shared deletion function serves the webhook and the purge command.
