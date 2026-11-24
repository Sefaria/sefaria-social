// The server's configuration (spec 040): Coolify substitutes an empty string for a variable that is not set on the app, so an
// empty call variable must count as unset, and the server must still start.
import { afterEach, describe, expect, it } from "vitest";
import { getConfig, resetConfig } from "./config";

const CALL_VARS = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "CALLS_ENABLED"] as const;
const saved = Object.fromEntries(CALL_VARS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of CALL_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetConfig();
});

describe("server configuration", () => {
  // @feature OPS-095 Two-browser call journey on a local LiveKit
  it("treats an empty call variable as unset, so a deployment without calls still starts", () => {
    for (const k of CALL_VARS) process.env[k] = "";
    resetConfig();
    const c = getConfig();
    expect([c.LIVEKIT_URL, c.LIVEKIT_API_KEY, c.LIVEKIT_API_SECRET, c.CALLS_ENABLED]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  // @feature OPS-095 Two-browser call journey on a local LiveKit
  it("still refuses a malformed LiveKit URL", () => {
    process.env.LIVEKIT_URL = "https://not-a-websocket.example";
    resetConfig();
    expect(() => getConfig()).toThrow(/Invalid server configuration: LIVEKIT_URL/);
  });
});
