# @sefaria-social/relay

Cloudflare Worker with one Durable Object per room (plan 1.1, 6.4), running the room from `@sefaria-social/session`.
Started from the reader's `reader-next/relay/worker.ts` (decision 0007).

| Route                           | Who                                                                 | What                                                   |
| ------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| `GET /health`                   | anyone                                                              | `ok`                                                   |
| `GET /r/<roomId>` (WebSocket)   | a page on `ALLOWED_ORIGINS` with a Sefaria identity token           | the room                                               |
| `GET /internal/status/<roomId>` | the social server (`Authorization: Bearer <RELAY_INTERNAL_SECRET>`) | `{ref, title, participants}`                           |
| `POST /internal/drop-user`      | the social server (same secret)                                     | close a deleted user's sockets, refuse them for 30 min |

The token travels in `Sec-WebSocket-Protocol` (`sefaria-social.v1, bearer.<token>`), never in the URL; it is verified
against `JWKS_URL` (RS256, `iss` = `TOKEN_ISSUER`, `aud` = `sefaria-social`). The token's `sub` and `name` replace whatever
a client claims in `join`.

- Local: copy `.dev.vars.example` to `.dev.vars`, then `npm run relay:dev` (port 8787).
- Tests: `npm run test:relay` (workerd through Miniflare; CI runs them in the `integration` job).
- Deploy: not automated; see `docs/runbooks/setup-checklist.md` ("Added by P3").
