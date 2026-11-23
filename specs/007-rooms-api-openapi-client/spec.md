---
id: "007"
title: Rooms API with ownership checks, OpenAPI document and generated client
status: approved
features: [ROOM-007, API-007]
owner: "@Sefaria/sefaria-social-owners"
surfaces: []
risk: high
contract_impact: api-minor
---

## Problem

Rooms are the first social object: a signed-in learner creates a room, sees the rooms they belong to, renames or deletes
the rooms they own. Every read or write by id must check that the caller may see the room (plan section 6.1). The surface
must call the API through a typed client generated from an OpenAPI document that is itself generated from the server's
zod schemas, and an API change that would break an older surface must be stopped in CI (plan section 6.2).

## Acceptance criteria

- AC-001 WHEN a signed-in user calls `POST /api/v1/rooms` with a title of 1 to 120 characters after trimming THE SYSTEM
  SHALL create a room owned by that user, make the user its member with role `owner`, store the user's display name and
  picture from the token in the display cache, and respond 201 with the room (`id`, `title`, `ownerUserId`, `role`,
  `createdAt`, `updatedAt`).
- AC-002 WHEN a signed-in user calls `GET /api/v1/rooms` THE SYSTEM SHALL respond 200 with only the rooms that user is a
  member of, newest first.
- AC-003 WHEN a user calls `GET`, `PATCH` or `DELETE /api/v1/rooms/{roomId}` for a room they are not a member of, or that
  does not exist, THE SYSTEM SHALL respond 404 with `room.not_found`, the same answer in both cases, and change nothing.
- AC-004 WHEN a member who is not the owner calls `PATCH` or `DELETE /api/v1/rooms/{roomId}` THE SYSTEM SHALL respond 403
  with `room.forbidden` and change nothing; WHEN the owner does, THE SYSTEM SHALL rename the room (200 with the room) or
  delete it with its memberships (204).
- AC-005 WHEN a request body or path parameter does not match its schema THE SYSTEM SHALL respond 400 with
  `request.invalid` and change nothing.
- AC-006 WHEN the API's zod schemas change THE SYSTEM SHALL keep `packages/api-client/openapi.json` and the generated
  client types `packages/api-client/src/schema.ts` equal to what the schemas produce, and a check SHALL fail with the
  command to regenerate them when they differ.
- AC-007 WHEN a pull request's OpenAPI document removes an operation, removes a response property or makes it optional,
  changes a property's type, or adds a required request property or parameter, compared with the base, THE SYSTEM SHALL
  fail the breaking-change check naming each change, unless a spec changed in that pull request declares
  `contract_impact: api-major`.

## Out of scope

- Joining, leaving and inviting (P3 rooms specs); room presence, chat and the relay.
- Shiurim and recordings endpoints (their tables exist from spec 005; endpoints come with their specs).
- Pagination (a user's room list is small in P2; a later spec adds a cursor if needed).
- The surface UI that uses the client.

## Notes for the planner

- Thin route handlers under `app/src/routes/api/v1/`; logic in `app/src/server/services/rooms.ts`; one transaction per
  write, no queries in loops, no I/O inside a transaction.
- Non-members get 404 rather than 403 so room ids cannot be probed.
- OpenAPI 3.1 built from the endpoint contracts with zod 4's JSON Schema output; the client uses `openapi-typescript`
  types and `openapi-fetch`, adds the Bearer token from a callback and an `X-Correlation-Id`.
- The breaking-change check compares the PR's `openapi.json` with the merge base's; with no document on the base it
  passes with a notice.
