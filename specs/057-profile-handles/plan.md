# Plan: spec 057

## Approach

- Migration: `profiles.handle` text and a unique index on `lower(handle)`.
- `server/services/handles.ts`: `canonicalHandle` (NFKC, lower case, drop `@`, cap the length before any pattern), `handleError`
  (rules and the reserved list), `suggestHandle(name)` (strip accents, keep `a–z0–9_`, `learner` when empty), and
  `ensureHandle(db, profileId, name)`, which tries the suggestion, then with 2, 3, … until an insert does not clash (the unique
  index decides, so two first sign-ins at once cannot share one).
- `person-profile.ts` gives a new person a handle; profile and post DTOs read it, assigning one when it is missing.
- `PATCH /profiles/me` takes `handle`; `GET /profiles/by-handle/{handle}`.
- Client: `ProfileForm` gets the Handle field and its errors; `ProfilePage` and the post author line show `@handle`.

## Tests

`api.handles.int.test.ts` (L2) for AC-001..003; `profile-handle.test.tsx` renders the form and the page for AC-004..005. Each
asserts the new behaviour first, so it fails on the base.
