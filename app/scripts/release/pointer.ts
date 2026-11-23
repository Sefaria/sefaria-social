// The stable manifest pointer (spec 020 AC-002, AC-003). The reader's PUBLIC_SOCIAL_MANIFEST_URL points at
// stable/manifest.json; promoting a version rewrites it to point into v/<version>/, and rolling back rewrites it to the last
// known-good version. stable/state.json records the current version, the known-good versions (newest first) and the versions
// that were rolled back (never promoted again).
import { MANIFEST, STABLE_MANIFEST, STABLE_STATE, parseManifest, pointerManifest, versionPrefix } from "./manifest";
import { smokeVersion } from "./smoke";
import { NO_STORE, POINTER, contentTypeOf, type StorageTarget } from "./storage";

export interface PointerState {
  v: 1;
  current: string | null;
  /** Versions that were stable before, newest first: where a rollback goes. */
  knownGood: string[];
  rolledBack: string[];
  log: { at: string; action: "promote" | "rollback"; version: string; from: string | null }[];
}

/** How many earlier stable versions are kept as rollback targets. */
export const KEEP_KNOWN_GOOD = 10;

export async function readState(target: StorageTarget): Promise<PointerState> {
  const obj = await target.get(STABLE_STATE);
  if (!obj) return { v: 1, current: null, knownGood: [], rolledBack: [], log: [] };
  return JSON.parse(obj.body.toString("utf8")) as PointerState;
}

async function writePointer(target: StorageTarget, version: string): Promise<void> {
  const obj = await target.get(`${versionPrefix(version)}${MANIFEST}`);
  if (!obj) throw new Error(`version ${version} is not published`);
  const manifest = parseManifest(obj.body.toString("utf8"), `${versionPrefix(version)}${MANIFEST}`);
  const body = Buffer.from(`${JSON.stringify(pointerManifest(manifest, version), null, 2)}\n`);
  await target.put(STABLE_MANIFEST, body, { contentType: contentTypeOf(STABLE_MANIFEST), cacheControl: POINTER });
}

async function writeState(target: StorageTarget, state: PointerState): Promise<void> {
  const body = Buffer.from(`${JSON.stringify(state, null, 2)}\n`);
  await target.put(STABLE_STATE, body, { contentType: contentTypeOf(STABLE_STATE), cacheControl: NO_STORE });
}

async function mustBeGood(target: StorageTarget, version: string, action: string): Promise<void> {
  const problems = await smokeVersion(target, version);
  if (problems.length)
    throw new Error(`refusing to ${action} ${version}; the smoke test failed:\n  - ${problems.join("\n  - ")}`);
}

/** Smoke-test a published version, then point the stable manifest at it. The previous stable version becomes known-good. */
export async function promote(target: StorageTarget, version: string, now = new Date()): Promise<PointerState> {
  const state = await readState(target);
  if (state.rolledBack.includes(version))
    throw new Error(
      `refusing to promote ${version}: it was rolled back. Fix: publish a new version with the fix (SURFACE_VERSION) and promote that.`,
    );
  await mustBeGood(target, version, "promote");
  if (state.current === version) return state;
  await writePointer(target, version);
  const next: PointerState = {
    ...state,
    current: version,
    knownGood: [state.current, ...state.knownGood].filter((v): v is string => !!v && v !== version).slice(0, KEEP_KNOWN_GOOD),
    log: [...state.log, { at: now.toISOString(), action: "promote", version, from: state.current }],
  };
  await writeState(target, next);
  return next;
}

/** Point the stable manifest back at the last known-good version (or at `to`, which must be known-good). */
export async function rollback(target: StorageTarget, to?: string, now = new Date()): Promise<PointerState> {
  const state = await readState(target);
  if (!state.current) throw new Error("refusing to roll back: nothing has been promoted yet.");
  const dest = to ?? state.knownGood[0];
  if (!dest)
    throw new Error(
      `refusing to roll back: ${state.current} is the only version that was ever stable, so there is no known-good version to go back to. ` +
        "Fix: publish and promote a fixed version, or turn the reader's social lab off (feature.reader.labs.social) meanwhile.",
    );
  if (!state.knownGood.includes(dest))
    throw new Error(
      `refusing to roll back to ${dest}: it is not a known-good version (known-good: ${state.knownGood.join(", ") || "none"}).`,
    );
  await mustBeGood(target, dest, "roll back to");
  await writePointer(target, dest);
  const next: PointerState = {
    ...state,
    current: dest,
    knownGood: state.knownGood.filter((v) => v !== dest),
    rolledBack: [...new Set([...state.rolledBack, state.current])],
    log: [...state.log, { at: now.toISOString(), action: "rollback", version: dest, from: state.current }],
  };
  await writeState(target, next);
  return next;
}
