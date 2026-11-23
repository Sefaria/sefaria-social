// Release storage targets (spec 020). The release writes immutable versioned files and a stable manifest pointer to a target;
// the reader fetches the pointer from one configured URL. Two targets:
//  - FileTarget (`RELEASE_TARGET=file:<dir>`): a folder, for local rehearsals, CI rehearsals and the e2e. Each object keeps its
//    content type and cache header in a sidecar under `.meta/`, which the static server (serve.ts) sends back.
//  - BucketTarget (`RELEASE_TARGET=bucket:<name>`): a stub. The object store for social assets does not exist yet (plan 9,
//    D2); it refuses every call. docs/runbooks/deploy.md says what implementing it takes.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PutOptions {
  contentType: string;
  cacheControl: string;
}

export interface StoredObject extends PutOptions {
  body: Buffer;
}

export interface StorageTarget {
  /** A one-line description for logs ("file:/tmp/x"). Never contains a credential. */
  describe(): string;
  get(key: string): Promise<StoredObject | null>;
  put(key: string, body: Uint8Array, opts: PutOptions): Promise<void>;
  /** Keys under a prefix ("v/"), sorted. */
  list(prefix: string): Promise<string[]>;
}

/** Versioned files never change, so browsers and CDNs may keep them for a year. */
export const IMMUTABLE = "public, max-age=31536000, immutable";
/** The stable manifest is the pointer: every load revalidates it (the reader also fetches it with cache: "no-cache"). */
export const POINTER = "no-cache";
/** Release bookkeeping, never cached. */
export const NO_STORE = "no-store";

export const META_DIR = ".meta";

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export function contentTypeOf(key: string): string {
  return TYPES[path.extname(key)] ?? "application/octet-stream";
}

/** A storage key: relative, forward slashes, no `.`/`..` segments, nothing under the metadata folder. */
export function checkKey(key: string): string {
  const parts = key.split("/");
  if (!key || key.startsWith("/") || key.includes("\\") || parts.some((p) => p === "" || p === "." || p === ".."))
    throw new Error(`invalid storage key "${key}"`);
  if (parts[0] === META_DIR) throw new Error(`storage key "${key}" is inside the reserved ${META_DIR}/ folder`);
  return key;
}

export class FileTarget implements StorageTarget {
  constructor(readonly root: string) {}

  describe() {
    return `file:${this.root}`;
  }

  private paths(key: string) {
    checkKey(key);
    return { body: path.join(this.root, key), meta: path.join(this.root, META_DIR, `${key}.json`) };
  }

  async get(key: string): Promise<StoredObject | null> {
    const p = this.paths(key);
    if (!existsSync(p.body)) return null;
    const body = await readFile(p.body);
    const meta = existsSync(p.meta)
      ? (JSON.parse(await readFile(p.meta, "utf8")) as PutOptions)
      : { contentType: contentTypeOf(key), cacheControl: NO_STORE };
    return { body, ...meta };
  }

  async put(key: string, body: Uint8Array, opts: PutOptions): Promise<void> {
    const p = this.paths(key);
    // Write then rename, so a reader of the folder (the static server) never sees half a file, and the pointer moves at once.
    for (const [target, data] of [
      [p.meta, JSON.stringify({ contentType: opts.contentType, cacheControl: opts.cacheControl })],
      [p.body, body],
    ] as const) {
      await mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, data);
      await rename(tmp, target);
    }
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string, rel: string) => {
      if (!existsSync(dir)) return;
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (!rel && e.name === META_DIR) continue;
        const key = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(path.join(dir, e.name), key);
        else if (key.startsWith(prefix) && !key.endsWith(".tmp")) out.push(key);
      }
    };
    await walk(this.root, "");
    return out.sort();
  }
}

export class BucketTarget implements StorageTarget {
  constructor(readonly bucket: string) {}

  describe() {
    return `bucket:${this.bucket}`;
  }

  /** Called when the target is chosen: the stub refuses at once, so a release stops before it builds anything. */
  ensureReady(): void {
    this.refuse();
  }

  private refuse(): never {
    throw new Error(
      `RELEASE_TARGET=bucket:${this.bucket}: the object-store target is a stub. Social's asset hosting does not exist yet ` +
        `(plan 9, D2: no bucket, domain or credentials). Fix: implement BucketTarget in app/scripts/release/storage.ts for the ` +
        `chosen store once it exists (docs/runbooks/deploy.md, "Asset storage"); until then rehearse with RELEASE_TARGET=file:<dir>.`,
    );
  }

  get(): Promise<StoredObject | null> {
    return this.refuse();
  }
  put(): Promise<void> {
    return this.refuse();
  }
  list(): Promise<string[]> {
    return this.refuse();
  }
}

/** The target named by RELEASE_TARGET (or --target): `file:<dir>` or `bucket:<name>`. */
export function targetFromSpec(spec: string | undefined): StorageTarget {
  const help =
    "Fix: set RELEASE_TARGET=file:<folder> for a local or CI rehearsal, or bucket:<name> for the real asset store once it exists (docs/runbooks/deploy.md).";
  if (!spec) throw new Error(`RELEASE_TARGET is not set. ${help}`);
  const m = spec.match(/^(file|bucket):(.+)$/);
  if (!m) throw new Error(`RELEASE_TARGET "${spec}" is not file:<folder> or bucket:<name>. ${help}`);
  if (m[1] === "file") return new FileTarget(path.resolve(m[2]!));
  const target = new BucketTarget(m[2]!);
  target.ensureReady();
  return target;
}
