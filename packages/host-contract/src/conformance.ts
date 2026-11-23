// Compile-time proof that each runtime schema in schemas.ts produces exactly the pinned contract type it guards. If the
// reader changes a type in the contract (and the pin is updated), `npm run typecheck` fails here until the schema follows.
// Nothing in this file runs.
import type { z } from "zod";
import type { ReaderSnapshot, SnapshotChange, SurfaceHost } from "./contract";
import type {
  contractVersionSchema,
  hostConfigSchema,
  hostLocationSchema,
  readerSnapshotSchema,
  reportEventSchema,
  snapshotChangeSchema,
  viewerSchema,
} from "./schemas";

/** True only when A and B are mutually assignable. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type Conformance = [
  Assert<Same<z.infer<typeof contractVersionSchema>, SurfaceHost["contract"]>>,
  Assert<Same<z.infer<typeof hostLocationSchema>, ReturnType<SurfaceHost["location"]["get"]>>>,
  Assert<Same<z.infer<typeof viewerSchema>, ReturnType<SurfaceHost["viewer"]["get"]>>>,
  Assert<Same<z.infer<typeof hostConfigSchema>, SurfaceHost["config"]>>,
  Assert<Same<z.infer<typeof reportEventSchema>, Parameters<SurfaceHost["report"]>[0]>>,
  Assert<Same<z.infer<typeof readerSnapshotSchema>, ReaderSnapshot>>,
  Assert<Same<z.infer<typeof snapshotChangeSchema>, SnapshotChange>>,
];
