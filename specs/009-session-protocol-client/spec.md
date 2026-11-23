---
id: "009"
title: Room protocol and client in packages/session, kept in step with the reader's copy
status: approved
features: [SESS-009, SESS-040]
owner: "@Sefaria/sefaria-social-owners"
surfaces: []
risk: high
contract_impact: none
---

## Problem

Rooms need a protocol (one connection, channels `state`, `control`, `presence`, `chat`) and a client that publishes the
viewer's reader stream and follows someone else's through the reader state API. The reader already has both
(`reader-next/src/lib/session`, on top of its reader-state core), with limits of 16 KB per frame, 200 participants and 20
state messages per second (plan 6.4). Social starts from that code instead of writing a second protocol, and must not let
the two copies drift apart silently while the reader's follow lab keeps its own copy (until milestone P6).

## Acceptance criteria

- AC-001 WHEN a room built with `createRoom` from `@sefaria-social/session` receives envelopes from its connections THE
  SYSTEM SHALL validate, limit and relay them as the reader's room does: a frame over 16 384 bytes is dropped, a 201st
  participant is refused, a connection's state messages beyond 20 per second are not relayed, and whatever a client puts
  in `from`, `seq`, `t` or `term` is replaced by the room's own values.
- AC-002 WHEN a session client joins a room THE SYSTEM SHALL follow the spotlight holder (or the participant picked with
  `follow(id)`) by applying their stream through the reader state API with origin `follow`, and SHALL publish its own
  moment-scoped stream only while the room needs it and the `canPublish()` option allows it.
- AC-003 WHEN the WebSocket transport opens or reopens a connection THE SYSTEM SHALL ask its `protocols` callback for the
  subprotocols each time, so a fresh identity token travels in `Sec-WebSocket-Protocol` and never in the URL.
- AC-004 WHEN the protocol fixtures (`packages/session/fixtures/protocol.v1.json`, results recorded with the reader's own
  room code) are replayed THE SYSTEM SHALL produce exactly the recorded result for every case, on the room side
  (`parseEnvelope`) and the client side (`parseRoomEnvelope`), and `LIMITS` and `PROTOCOL_VERSION` SHALL equal the
  recorded values; a change to either copy that alters a result makes the test fail and name the case.
- AC-005 WHEN `npm run fixtures -w @sefaria-social/session -- --check <reader checkout>` runs THE SYSTEM SHALL recompute
  every expected result with the reader checkout's room code and fail naming each case whose result differs, and
  `packages/session/SOURCE.json` SHALL record the reader commit and the sha256 of every file copied from it.

## Out of scope

- The relay (spec 010) and anything in the app (specs 011–014).
- Chat: the channel stays reserved, as in the reader.
- Moving the reader's follow lab onto this package (milestone P6).

## Notes for the planner

- Copy `src/lib/session/{protocol,ids,room,incoming,outgoing,client}.ts` and the reader-state core they need (types, json,
  diff, schema, stream, registry, api, the listeners/memory/websocket transports) with their tests; rewrite only the `~/`
  imports. Record the commit in `docs/decisions/` and `SOURCE.json`. The reader's repo is GPL-3.0 and the same
  organisation's; the files carry no licence header.
- Local changes allowed, each listed in SOURCE.json: `canPublish` on the client; a `protocols` callback on the transport;
  `/social` pages are private in the outgoing view. None changes the wire format.
