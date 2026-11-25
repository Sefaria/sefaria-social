# 0012. Links in posts and live cards: the choices the plan left open

- Status: accepted
- Date: 2026-11-25
- Deciders: the agent building shiur group D (specs 055, 056), within the owner's decisions D9 and the proposals of
  `docs/plans/shiur.md` 4.7; open to the owner's change when he reviews the specs

## Context

Plan 4.7 says a posted room, broadcast or recording link becomes a card, that the card shows the leader's current text, and
proposes the mechanics (the relay reports to the server, the feed polls a public endpoint). Several details were left open.

## Decision

- **One card per post** (plan section 8, a proposal): the first session link in the composer's text becomes the card; later
  ones stay text.
- **Which links count:** `/social/r|b|rec/<uuid>`, as a path or an http(s) URL on `sefaria.org`, `sefaria.org.il`, any
  `*.sefaria.org` host (cauldrons, previews) or the page's own origin. The server stores `{kind, id}` only, never the URL.
- **Undo:** Remove on the card puts the link back where it was. The browser's own undo is not wired to the card (React's
  controlled textarea does not keep a native undo stack across a programmatic change); the plan's "undo restores the link" is
  met by Remove.
- **Empty text:** a post may have empty text when it has a card, so a pasted link alone can be posted.
- **The live endpoint answers only for sessions some post embeds.** It is public (signed out included), and D9 makes a posted
  room an open invitation; a room nobody posted stays private, so the endpoint cannot be used to probe room ids.
- **Freshness:** the relay reports on change, at least once a minute while anyone is connected, and once when the room
  empties, never more than once per room per 5 seconds; the server calls a room live only with a report under 3 minutes old.
  A relay object that dies without a last report therefore stops looking live after 3 minutes.
- **Two sources, one answer:** the relay needs a new variable, `SOCIAL_SERVER_URL`, to report. Until it is set in an
  environment the server falls back to reading the relay's existing status route for ids with no fresh report (as the feed's
  room cards already do), behind the same 5-second cache. Once every relay reports, the fallback can be removed.
- **The report is signed** with HMAC-SHA256 of the raw body under `RELAY_INTERNAL_SECRET` (the format of Django's webhook
  signature), and carries a timestamp the server accepts within 5 minutes.

## Consequences

- A setup step: set `SOCIAL_SERVER_URL` on each relay (`docs/runbooks/setup-checklist.md`).
- `GET /api/v1/live` is on the public list; its reviewer checks the embed-only rule above.
