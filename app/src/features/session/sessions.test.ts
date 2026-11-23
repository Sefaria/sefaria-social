// A reader with no relay configured sends relayOrigin "" (the contract types it as string). Room sessions then open nothing,
// as for a signed-out viewer, instead of dialling a WebSocket URL built from an empty origin.
import { describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import { createRoomSessions, relayUrl, type TransportFactory } from "./sessions";

const VIEWER = { id: 4242, name: "Test Learner" };

function spyTransport() {
  const urls: string[] = [];
  const factory: TransportFactory = (url) => {
    urls.push(url);
    return { send: vi.fn(), subscribe: () => () => undefined, close: vi.fn(), start: vi.fn() } as never;
  };
  return { urls, factory };
}

describe("room sessions", () => {
  it("opens no socket when the reader has no relay configured, and the release does nothing", () => {
    const { host } = createFakeHost({ viewer: VIEWER, config: { relayOrigin: "" } });
    const { urls, factory } = spyTransport();
    const sessions = createRoomSessions(host, factory);
    const release = sessions.acquire("room-1", "lobby");
    expect(urls).toEqual([]);
    expect(sessions.get("room-1")).toBeNull();
    expect(sessions.rooms()).toEqual([]);
    expect(() => release()).not.toThrow();
  });

  it("dials <relayOrigin>/r/<roomId> as a WebSocket URL when a relay is configured", () => {
    expect(relayUrl("https://relay.example.test/", "room 1")).toBe("wss://relay.example.test/r/room%201");
    expect(relayUrl("ws://127.0.0.1:8787", "r")).toBe("ws://127.0.0.1:8787/r/r");
  });
});
