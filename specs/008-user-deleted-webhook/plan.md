# Plan: 008 account deletion removes the user's social data

## Approach

- `app/src/server/webhooks/signature.ts`: HMAC-SHA256 over the raw body bytes, `sha256=` prefix, constant-time compare
  (`timingSafeEqual` on equal-length buffers); tested with Django's vector.
- The 005 wrapper gains access `sefaria-webhook`: it reads the raw body, verifies the signature before parsing, and answers
  401 `webhook.bad_signature` otherwise.
- `app/src/server/services/users.ts` `deleteUserData(tx, userId, eventId)`: one transaction, a fixed sequence of set-based
  deletes (memberships, recordings, shiurim, owned rooms, display), tombstone upsert; returns counts per table.
- `app/src/server/webhooks/user-deleted.ts`: insert the receipt (`on conflict do nothing returning`); duplicate → 200
  `duplicate`; `user.deleted` → delete + tombstone in the same transaction → 200 `processed`; other event types → 200
  `ignored`.
- The `user` access check also refuses a tombstoned `sub` (401 `auth.user_deleted`).
- `npm run purge-user -- <id>` (`app/scripts/purge-user.ts`) calls the same function and prints the counts.

## Tests

- `app/src/api.user-deleted.int.test.ts` (acceptance, real Postgres): signature cases, processed with the schema walk,
  duplicate, tombstoned token, purge command (spawned as a child process against the test database), ignored type.
- The schema walk (`test/integration/schema-walk.ts`): lists every column of every table in the `public` schema from
  `information_schema.columns`, counts rows whose value (as text, and inside JSON) equals the user id, and allows only
  `deleted_users.user_id`. The seed (`seedEveryTable`) must cover every table the schema has, or the test fails, so a new
  table without deletion coverage turns it red. A negative test adds a scratch table holding the id and expects the walk
  to report it.

## Risks

- A request that passed the tombstone check just before deletion could still write; the window is one request. Recorded.
