// Contract (L3): social's copy of the room protocol answers every recorded case exactly as the reader's code did (plan 6.4,
// spec 009). fixtures/protocol.v1.json is recorded from the reader with scripts/fixtures.mjs; this test replays it here.
// Everything is loaded through import.meta.glob so that, on a base without this package, the first assertion fails.
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type * as RoomModule from "./room";
import type * as IncomingModule from "./incoming";
import type * as ProtocolModule from "./protocol";

interface Case {
  name: string;
  input: unknown;
  expected: unknown;
}
interface Fixture {
  recordedFrom: { repo: string; commit: string | null };
  constants: { LIMITS: unknown; PROTOCOL_VERSION: number };
  room: Case[];
  client: Case[];
}
interface FixturesScript {
  main(argv: string[], log: (s: string) => void, err: (s: string) => void): number;
}

const fixtures = import.meta.glob<Fixture>("../fixtures/protocol.v1.json", { import: "default" });
const rooms = import.meta.glob<typeof RoomModule>("./room.ts");
const incomings = import.meta.glob<typeof IncomingModule>("./incoming.ts");
const protocols = import.meta.glob<typeof ProtocolModule>("./protocol.ts");
const scripts = import.meta.glob<FixturesScript>("../scripts/fixtures.mjs");

const norm = (x: unknown) => (x === undefined ? null : JSON.parse(JSON.stringify(x)));

describe("protocol fixtures recorded from the reader", () => {
  // @feature SESS-040 Protocol fixtures keep social's and the reader's copies in step
  // @ac 009/AC-004
  it("every recorded case gives the recorded result here, room side and client side, with the same limits", async () => {
    const fixture = await fixtures["../fixtures/protocol.v1.json"]?.();
    expect(fixture, "packages/session/fixtures/protocol.v1.json exists").toBeDefined();
    const room = (await rooms["./room.ts"]!())!;
    const incoming = (await incomings["./incoming.ts"]!())!;
    const protocol = (await protocols["./protocol.ts"]!())!;

    expect({ LIMITS: protocol.LIMITS, PROTOCOL_VERSION: protocol.PROTOCOL_VERSION }).toEqual(fixture!.constants);
    expect(fixture!.constants.LIMITS).toEqual({ maxMessageBytes: 16_384, maxParticipants: 200, stateMessagesPerSecond: 20 });
    // Compared as name → result maps, so a failure names every case that differs.
    const here = (cases: Case[], parse: (x: unknown) => unknown) =>
      Object.fromEntries(cases.map((c) => [c.name, norm(parse(c.input))]));
    const recorded = (cases: Case[]) => Object.fromEntries(cases.map((c) => [c.name, c.expected]));
    expect(here(fixture!.room, (x) => room.parseEnvelope(x))).toEqual(recorded(fixture!.room));
    expect(here(fixture!.client, (x) => incoming.parseRoomEnvelope(x))).toEqual(recorded(fixture!.client));
    expect(fixture!.room.length + fixture!.client.length).toBeGreaterThanOrEqual(60);
  });

  // @feature SESS-040 Protocol fixtures keep social's and the reader's copies in step
  // @ac 009/AC-005
  it("the drift check against a reader checkout fails and names the case the reader now answers differently", async () => {
    const script = await scripts["../scripts/fixtures.mjs"]?.();
    expect(script, "packages/session/scripts/fixtures.mjs exists").toBeDefined();
    // A stand-in checkout laid out like Sefaria-Project, holding this package's code with one change: the room no longer
    // accepts "raise-hand".
    const checkout = mkdtempSync(path.join(tmpdir(), "reader-checkout-"));
    try {
      const session = path.join(checkout, "reader-next", "src", "lib", "session");
      const core = path.join(checkout, "reader-next", "src", "lib", "reader-state", "core");
      cpSync(path.join(import.meta.dirname, "core"), core, { recursive: true });
      cpSync(import.meta.dirname, session, { recursive: true, filter: (src) => !src.includes(`${path.sep}core`) });
      for (const file of readdirSync(session).filter((f) => f.endsWith(".ts"))) {
        const p = path.join(session, file);
        writeFileSync(p, readFileSync(p, "utf8").replaceAll('"./core/', '"../reader-state/core/'));
      }
      // Dependencies (zod) resolve as they would in a checkout with reader-next/node_modules installed.
      symlinkSync(
        path.resolve(import.meta.dirname, "../../../node_modules"),
        path.join(checkout, "reader-next", "node_modules"),
        "dir",
      );
      const roomFile = path.join(session, "room.ts");
      writeFileSync(roomFile, readFileSync(roomFile, "utf8").replace('case "raise-hand":\n', ""));

      const out: string[] = [];
      const err: string[] = [];
      const pass = script!.main(
        ["--check", checkout],
        (s) => out.push(s),
        (s) => err.push(s),
      );
      expect({
        code: pass,
        lines: err
          .join("\n")
          .split("\n")
          .filter((l) => l.startsWith("  x ")),
      }).toEqual({
        code: 1,
        lines: ["  x room: raise-hand"],
      });
      const sourced = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "SOURCE.json"), "utf8"));
      expect(Object.keys(sourced.files).length).toBeGreaterThanOrEqual(25);
      expect(sourced.commit).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      rmSync(checkout, { recursive: true, force: true });
    }
  });
});
