// LiveKit, the media server for room calls (spec 033; design docs/design/audio-video.md 5.1–5.2). The only module that
// imports livekit-server-sdk. The API key and secret stay here: a browser only ever receives a short-lived token for one
// room. Tokens are bearer credentials for the media server; never log them or pass them anywhere but the response.
import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver } from "livekit-server-sdk";
import { log } from "../log/logger";
import { getConfig } from "../config";

/** How long a call token is valid. LiveKit checks it only when a client connects, so this does not cut a live call. */
export const CALL_TOKEN_TTL_SECONDS = 600;

export interface CallsConfig {
  url: string;
  key: string;
  secret: string;
}

/** The LiveKit settings, or null when calls are not available (switched off, or any variable missing). */
export function callsConfig(): CallsConfig | null {
  const c = getConfig();
  if (c.CALLS_ENABLED !== "true" || !c.LIVEKIT_URL || !c.LIVEKIT_API_KEY || !c.LIVEKIT_API_SECRET) return null;
  return { url: c.LIVEKIT_URL, key: c.LIVEKIT_API_KEY, secret: c.LIVEKIT_API_SECRET };
}

export const callsAvailable = (): boolean => callsConfig() !== null;

/** LiveKit's room name for a social room: one namespace, so other kinds of call (shiurim) cannot collide. */
export const livekitRoomName = (roomId: string) => `room_${roomId}`;

/** LiveKit's participant identity for a Sefaria user: the auth_user id, never the hashed username. */
export const livekitIdentity = (userId: number) => `u:${userId}`;

export interface CallTokenInput {
  config: CallsConfig;
  roomId: string;
  userId: number;
  name: string;
  role: "owner" | "member";
}

export interface CallTokenDto {
  url: string;
  token: string;
  expiresAt: string;
}

/**
 * A token to join one room's call. Every member may publish microphone, camera and screen share (owner decision D-AV2,
 * proposed default); data messages are off because chat and reading state stay on the relay. No admin or recording powers.
 */
export async function mintCallToken({ config, roomId, userId, name, role }: CallTokenInput): Promise<CallTokenDto> {
  const at = new AccessToken(config.key, config.secret, {
    identity: livekitIdentity(userId),
    name,
    ttl: CALL_TOKEN_TTL_SECONDS,
    metadata: JSON.stringify({ v: 1, role }),
  });
  at.addGrant({
    roomJoin: true,
    room: livekitRoomName(roomId),
    canSubscribe: true,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE],
    canPublishData: false,
  });
  const token = await at.toJwt();
  const exp = expiryOf(token);
  return { url: config.url, token, expiresAt: new Date(exp * 1000).toISOString() };
}

/** The token's own `exp`, so `expiresAt` can never disagree with what LiveKit will enforce. */
function expiryOf(jwt: string): number {
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: unknown };
  if (typeof payload.exp !== "number") throw new Error("LiveKit token has no exp");
  return payload.exp;
}

/**
 * Is this webhook body signed by our LiveKit project (spec 038)? The Authorization header is a JWT signed with the API secret
 * whose sha256 claim is the body's hash. Checked with LiveKit's own receiver. Needs only the key and secret, not CALLS_ENABLED:
 * a call that started before calls were switched off still reports its end.
 */
export async function verifyLivekitWebhook(raw: string, authorization: string | null): Promise<boolean | "unconfigured"> {
  const c = getConfig();
  if (!c.LIVEKIT_API_KEY || !c.LIVEKIT_API_SECRET) return "unconfigured";
  if (!authorization) return false;
  try {
    await new WebhookReceiver(c.LIVEKIT_API_KEY, c.LIVEKIT_API_SECRET).receive(raw, authorization.replace(/^Bearer\s+/i, ""));
    return true;
  } catch {
    return false;
  }
}

/** LiveKit's HTTP API lives at the same host as its WebSocket URL. */
const apiHost = (url: string) => url.replace(/^ws(s?):\/\//, "http$1://");

const isNotFound = (e: unknown) => {
  const x = e as { status?: unknown; code?: unknown } | null;
  return x?.status === 404 || x?.code === "not_found";
};

/**
 * Remove a deleted user from every room call that is live (spec 038 AC-005). Each removal is tried twice; "not found" (they
 * already left) counts as done. Failures are logged without the user id and never thrown: the deletion is already committed.
 * Uses the key and secret only, not CALLS_ENABLED, so calls that outlived the switch are still covered.
 */
export async function removeFromLiveCalls(userId: number, roomIds: readonly string[]): Promise<{ failed: number }> {
  const c = getConfig();
  if (!c.LIVEKIT_URL || !c.LIVEKIT_API_KEY || !c.LIVEKIT_API_SECRET || roomIds.length === 0) return { failed: 0 };
  const svc = new RoomServiceClient(apiHost(c.LIVEKIT_URL), c.LIVEKIT_API_KEY, c.LIVEKIT_API_SECRET, {
    requestTimeout: 5,
  });
  let failed = 0;
  await Promise.all(
    roomIds.map(async (roomId) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await svc.removeParticipant(livekitRoomName(roomId), livekitIdentity(userId));
          return;
        } catch (e) {
          if (isNotFound(e)) return;
          if (attempt === 1) {
            failed++;
            log.error("livekit.remove_failed", { room: livekitRoomName(roomId), error: e instanceof Error ? e.name : "unknown" });
          }
        }
      }
    }),
  );
  return { failed };
}

export type ModeratedSource = "microphone" | "camera" | "screen_share";
const SOURCE_OF: Record<ModeratedSource, TrackSource> = {
  microphone: TrackSource.MICROPHONE,
  camera: TrackSource.CAMERA,
  screen_share: TrackSource.SCREEN_SHARE,
};

function roomService(config: CallsConfig) {
  return new RoomServiceClient(apiHost(config.url), config.key, config.secret, { requestTimeout: 5 });
}

/** LiveKit's answer to a moderation call: done, or the participant (or that track) is not in the call (spec 039). */
export type ModerationResult = "done" | "not-in-call";

/** Mute one published track of a participant (spec 039 AC-001). */
export async function muteTrack(
  config: CallsConfig,
  roomId: string,
  identity: string,
  source: ModeratedSource,
): Promise<ModerationResult> {
  const svc = roomService(config);
  try {
    const p = await svc.getParticipant(livekitRoomName(roomId), identity);
    const track = p.tracks.find((t) => t.source === SOURCE_OF[source]);
    if (!track) return "not-in-call";
    await svc.mutePublishedTrack(livekitRoomName(roomId), identity, track.sid, true);
    return "done";
  } catch (e) {
    if (isNotFound(e)) return "not-in-call";
    throw e;
  }
}

/** Remove a participant from the call (spec 039 AC-002); the room itself is untouched. */
export async function removeFromCall(config: CallsConfig, roomId: string, identity: string): Promise<ModerationResult> {
  try {
    await roomService(config).removeParticipant(livekitRoomName(roomId), identity);
    return "done";
  } catch (e) {
    if (isNotFound(e)) return "not-in-call";
    throw e;
  }
}
