// Runtime schemas for everything that crosses the SurfaceHost contract (plan 4.2: "everything arriving is untrusted").
// The types come from the pinned contract; these schemas check values at run time. `conformance.ts` proves at compile time
// that each schema's output type matches the pinned type it guards, so the two cannot drift apart silently.
import { z } from "zod";

/** A function member of the host object. zod 4 has no function schema; presence and callability are what we can check. */
const fn = z.custom<(...args: never[]) => unknown>((v) => typeof v === "function", "a function");

/** `host.contract`: this surface is built for major 1; any minor is accepted (minors only add optional members). */
export const contractVersionSchema = z.object({ major: z.literal(1), minor: z.number().int().nonnegative() });

/** The reserved `ctx` URL parameter's grammar (plan 4.4): a surface namespace, a dot, an opaque rest. */
export const READER_CONTEXT_RE = /^[a-z][a-z0-9]*\.[A-Za-z0-9_.-]{1,160}$/;
export const readerContextSchema = z.string().regex(READER_CONTEXT_RE, "a ctx value: <namespace>.<rest>");

/** A same-site path: starts with one slash (never protocol-relative), no backslash, no whitespace or control characters. */
export const SAME_SITE_PATH_RE = /^\/(?![/\\])[^\s\\]*$/;
export const sameSitePathSchema = z.string().max(4096).regex(SAME_SITE_PATH_RE, "a same-site path starting with /");

/** `host.location.get()`. `state` is the surface's own history state for the entry, and untrusted. */
export const hostLocationSchema = z.object({
  pathname: z.string().regex(/^\//, "a pathname starting with /"),
  search: z.string().regex(/^(?:\?.*)?$/, 'empty or starting with "?"'),
  hash: z.string().regex(/^(?:#.*)?$/, 'empty or starting with "#"'),
  state: z.unknown(),
});

/** `host.viewer.get()`. */
export const viewerSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(200),
    imageUrl: z.string().url().optional(),
  })
  .nullable();

export const interfaceLangSchema = z.enum(["english", "hebrew"]);
export const themeSchema = z.enum(["light", "dark", "sepia"]);

export const hostConfigSchema = z.object({
  apiOrigin: z.string().url(),
  relayOrigin: z.string().url(),
  environment: z.enum(["local", "staging", "production"]),
});

export const reportEventSchema = z.object({
  kind: z.enum(["error", "event"]),
  name: z.string().min(1).max(100),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const sliceValueSchema = z.object({ v: z.number().int().nonnegative(), value: z.unknown() });

/** A reader snapshot as it arrives from a room or a recording. `url` is same-site and never carries `ctx` (R14). */
export const readerSnapshotSchema = z.object({
  v: z.literal(1),
  url: sameSitePathSchema.refine((u) => !/[?&]ctx=/.test(u), "a snapshot url never carries ctx"),
  nav: z.unknown(),
  slices: z.record(z.string(), sliceValueSchema),
});

export const snapshotChangeSchema = z.object({
  url: sameSitePathSchema.optional(),
  nav: z.unknown().optional(),
  slices: z.record(z.string(), sliceValueSchema.nullable()).optional(),
});

/**
 * The host object's shape, checked on mount before anything else is touched. A host from another major, or one missing a
 * member, fails here and the surface renders its "please reload" state instead of crashing inside the reader page.
 */
export const surfaceHostShapeSchema = z.object({
  contract: contractVersionSchema,
  location: z.object({ get: fn, subscribe: fn }),
  navigate: fn,
  href: fn,
  reader: z.object({
    state: z.object({ getSnapshot: fn, applySnapshot: fn, subscribe: fn, onLocalInput: fn }),
    commands: z.object({ current: fn, go: fn, href: fn, canonicalize: fn }),
    context: z.object({ get: fn, subscribe: fn }),
  }),
  viewer: z.object({ get: fn, subscribe: fn, identityToken: fn, requestSignIn: fn }),
  ui: z.object({ interfaceLang: interfaceLangSchema, theme: themeSchema, subscribe: fn }),
  config: hostConfigSchema,
  report: fn,
});
