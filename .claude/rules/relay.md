---
paths:
  - "packages/relay/**"
  - "packages/session/**"
---

# Relay and session

Summary of `docs/PLAN.md` sections 1.1 and 8 (P3). Built from milestone P3.

- One Durable Object per room. Room ids match `^[A-Za-z0-9_-]{8,128}$`.
- The relay verifies the identity token before joining a socket to a room.
- Outgoing snapshots never include the `ctx` parameter or anything personal (R14). Incoming snapshots are validated before they
  are applied, and only moment-scoped slices are applied (R13).
- `packages/relay/wrangler.toml` is a protected path.
