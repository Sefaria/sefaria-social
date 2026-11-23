// What the relay takes from @sefaria-social/session: the pure room and its limits (the room subpath, which carries no browser
// code). One import site, so the relay's dependency on the shared protocol is easy to see.
export { createRoom, type Outgoing, type Room } from "@sefaria-social/session/room";
export { LIMITS as LIMITS_FOR_RELAY } from "@sefaria-social/session/protocol";
