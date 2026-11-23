# @sefaria-social/session

The room protocol (channels `state`, `control`, `presence`, `chat`), the pure room the relay runs, and the session client
the surface uses. Started from the reader's `reader-next/src/lib/session` and the reader-state core it needs; `SOURCE.json`
records the reader commit, the sha256 of every copied file, and each local change. Decision:
`docs/decisions/0007-session-and-relay-from-the-reader.md`.

- `npm test -- packages/session`: the reader's own tests, carried over.
- Limits: 16 KB frames, 200 participants, 20 state messages per second (`LIMITS` in `src/protocol.ts`).
