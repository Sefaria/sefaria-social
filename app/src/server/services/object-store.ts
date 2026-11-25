// Where a shiur asset's files live (spec 051; docs/plans/shiur.md 4.5, 5.2): an object store, by key. Keys are made by the
// server only (`recordings/<uuid>/raw/<seq>`, later `media.webm`, `manifest.json` …); nothing a client sends becomes a key.
// The filesystem store serves local runs, e2e and the dev server (ASSET_STORE_DIR, default `.data/assets`); a cloud bucket gets
// its own adapter behind this interface when the owner creates it.
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config";

export interface ObjectStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** The object's bytes, or null when there is none. */
  get(key: string): Promise<Uint8Array | null>;
  /** The keys under `prefix` (which ends in "/"), in no particular order. */
  list(prefix: string): Promise<string[]>;
  /** Remove every object under `prefix` (which ends in "/"). */
  removePrefix(prefix: string): Promise<void>;
  /** Spec 052: the object's size in bytes, or null when there is none. */
  size(key: string): Promise<number | null>;
  /** Spec 052: bytes `start` to `end` (inclusive) of the object, or null when there is none. */
  getRange(key: string, start: number, end: number): Promise<Uint8Array | null>;
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** A key is "/"-separated segments of letters, digits, dot, dash and underscore; no "..", no empty segment. */
export function checkKey(key: string, prefix = false): string[] {
  const parts = (prefix ? key.replace(/\/$/, "") : key).split("/");
  if (parts.length === 0 || parts.some((p) => !SEGMENT.test(p) || p === "." || p === ".."))
    throw new Error(`object store: refused key "${key}"`);
  return parts;
}

/** The filesystem store: one file per object under `root`; writes go to a temporary name first, then are renamed. */
export function fileStore(root: string): ObjectStore {
  const at = (parts: string[]) => path.join(root, ...parts);
  return {
    async put(key, bytes) {
      const file = at(checkKey(key));
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, file);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(at(checkKey(key))));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async list(prefix) {
      const parts = checkKey(prefix, true);
      const dir = at(parts);
      const out: string[] = [];
      const walk = async (d: string, rel: string) => {
        let entries;
        try {
          entries = await readdir(d, { withFileTypes: true });
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
          throw e;
        }
        for (const e of entries) {
          if (e.name.endsWith(".tmp")) continue;
          if (e.isDirectory()) await walk(path.join(d, e.name), `${rel}${e.name}/`);
          else out.push(`${rel}${e.name}`);
        }
      };
      await walk(dir, `${parts.join("/")}/`);
      return out;
    },
    async removePrefix(prefix) {
      await rm(at(checkKey(prefix, true)), { recursive: true, force: true });
    },
    async size(key) {
      try {
        return (await stat(at(checkKey(key)))).size;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async getRange(key, start, end) {
      let fh;
      try {
        fh = await open(at(checkKey(key)), "r");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
      try {
        const length = Math.max(0, end - start + 1);
        const buf = new Uint8Array(length);
        const { bytesRead } = await fh.read(buf, 0, length, start);
        return buf.subarray(0, bytesRead);
      } finally {
        await fh.close();
      }
    },
  };
}

let cached: { dir: string; store: ObjectStore } | undefined;

/** The configured store (ASSET_STORE_DIR, default `.data/assets` under the working directory). */
export function objectStore(): ObjectStore {
  const dir = path.resolve(getConfig().ASSET_STORE_DIR ?? ".data/assets");
  if (cached?.dir !== dir) cached = { dir, store: fileStore(dir) };
  return cached.store;
}

/** The prefix of one recording's objects. */
export const recordingPrefix = (recordingId: string) => `recordings/${recordingId}/`;
/** A processed file of a recording (spec 052): `media.webm`, `audio.m4a`, `timeline.json`, `manifest.json`. */
export const assetKey = (recordingId: string, name: string) => `recordings/${recordingId}/${name}`;
/** A raw media chunk as uploaded (seq zero-padded, so keys sort in order). */
export const rawChunkKey = (recordingId: string, seq: number) => `recordings/${recordingId}/raw/${String(seq).padStart(6, "0")}`;
