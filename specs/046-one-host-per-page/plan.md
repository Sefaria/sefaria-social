# Plan: 046 one host per page for page-wide controllers

## T-001 (AC-001 – AC-003)

- `features/host/document-host.ts` (new), `surface/entry.ts` registers both mounts' hosts.
- `windowOwnerFor`, `callControllerFor`, `roomControllerFor`, `roomSessionsFor`, `roomsApiFor`, `recordingApiFor`,
  `recordingControllerFor`, `replayControllerFor`, `broadcastControllerFor`, `broadcastApiFor` start with `documentHostFor(host)`.
- Test `surface/two-hosts.test.tsx`: the entry mounts the page and the persistent mount with two fake hosts over one history.
