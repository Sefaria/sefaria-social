// @sefaria-social/session: the room protocol, the pure room, and the session client. Started from the reader's
// src/lib/session and its reader-state core; SOURCE.json records the commit and every local change.
export * from "./protocol";
export { createRoom, parseEnvelope, KEYFRAMES_PER_SECOND, CONTROL_MESSAGES_PER_SECOND } from "./room";
export type { Room, RoomOptions, RoomLimits, RoomSnapshot, Outgoing, ConnId } from "./room";
export { createSessionClient } from "./client";
export type { PresentParticipant, RoomState, SessionClient, SessionClientOptions, SessionState, SessionStatus } from "./client";
export { createWebSocketTransport, MAX_FRAME_BYTES } from "./core/transports/websocket";
export { createMemoryPair } from "./core/transports/memory";
export { isSessionId, newParticipantId, newSessionId } from "./ids";
export { fold, diff, isEmptyChange } from "./core/diff";
export { parseSnapshot, parseStreamMessage } from "./core/schema";
export type {
  ApplyContext,
  ApplyResult,
  ReaderSnapshot,
  ReaderStateApi,
  SliceFilter,
  SliceValue,
  SnapshotChange,
  StateTransport,
  StreamMessage,
  TransportStatus,
} from "./core/types";
