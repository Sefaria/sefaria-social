// Replays protocol fixture inputs through one copy of the protocol code and prints the results as JSON on stdout.
// Usage (by scripts/fixtures.mjs): tsx [--tsconfig <reader tsconfig>] scripts/evaluate.mts <session dir>  < inputs.json
// <session dir> holds room.ts, incoming.ts and protocol.ts: the reader's src/lib/session, or this package's src.
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = path.resolve(process.argv[2] ?? "");
const load = (name: string) => import(pathToFileURL(path.join(dir, `${name}.ts`)).href);
const [room, incoming, protocol] = await Promise.all([load("room"), load("incoming"), load("protocol")]);
const inputs = JSON.parse(readFileSync(0, "utf8")) as { room: { input: unknown }[]; client: { input: unknown }[] };
// JSON round trip: absent and undefined compare equal, as they do on the wire.
const norm = (x: unknown) => (x === undefined ? null : JSON.parse(JSON.stringify(x)));
process.stdout.write(
  JSON.stringify({
    constants: { LIMITS: protocol.LIMITS, PROTOCOL_VERSION: protocol.PROTOCOL_VERSION },
    room: inputs.room.map((c) => norm(room.parseEnvelope(c.input))),
    client: inputs.client.map((c) => norm(incoming.parseRoomEnvelope(c.input))),
  }),
);
