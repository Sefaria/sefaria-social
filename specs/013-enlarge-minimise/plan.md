# Plan: 013 enlarge and minimise

- `features/session/room-reader.ts`: `followGate(api, isOpen)` (holds what arrives while closed, filters to the viewer's
  moment slices, applies with origin follow) and `publishView(api, commands, canPublish)` (strip ctx, keep moment slices,
  drop nav.terms, add `social.summary`).
- `features/session/controller.ts`: one controller per host; owns the `SessionView`, drives `transition()`, listens to
  `host.reader.context`, and implements enlarge/minimise/back per R9–R12.
- `surface/persistent.tsx`: mini view; acquires the session with hold "context" while a social ctx is in the address.

## Tests

- `features/session/room-reader.test.ts` (AC-005, AC-006, unit).
- `surface/room-context.test.tsx` (AC-001..004, jsdom, fake host, test relay).
