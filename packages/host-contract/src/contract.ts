// The SurfaceHost v1 types, taken from the pinned copy of the reader's contract (pinned/surface-host.v1.ts; its source commit
// is in pinned/SOURCE.json). Nothing here is hand-copied: every type is re-exported from the pinned file, so when the reader
// removes or renames a member, the fake host and the surface stop compiling. Update the pin with `npm run pin -w
// @sefaria-social/host-contract -- <reader checkout> <commit>`; never edit pinned/ by hand.
export { SURFACE_HOST_CONTRACT } from "../pinned/surface-host.v1";
export type {
  AsideId,
  AsideState,
  ApplyContext,
  ApplyResult,
  LayoutNode,
  NavKind,
  NavState,
  PanelId,
  PanelState,
  ReaderSnapshot,
  ReaderStateApi,
  RestoreWarning,
  SliceFilter,
  SliceId,
  SliceValue,
  SnapshotChange,
  Surface,
  SurfaceHost,
  TextPanelState,
  Unmount,
  Unsubscribe,
  Workspace,
  WorkspaceCommands,
} from "../pinned/surface-host.v1";
export { surfaceManifestSchema, SRI_RE, type SurfaceManifest } from "../pinned/surface-manifest.v1";
