# Plan: spec 053

## Approach

- `ReplayBar.tsx`: the bar, fixed at the bottom above the reader's chrome insets, with the controls the transport had (same
  data-action names), chapter markers over the seek bar, the playing chapter, Hide video, and Space and arrow keys.
- `ReplayWindow.tsx`: the floating frame keeps only the video; it is pinned (`CallWindow`'s new `pinned` box) at the
  `social.overlay` head place at the playing time (`state-track.ts` `overlayAt`), and absent while the camera was off, when
  hidden, or for an audio-only shiur (`hasVideo` from the manifest). The call window's own place still feeds a recording's head
  place; a replay's window does not.
- `replay-api.ts`: signed out, or refused as a member, the public reads (`/api/v1/assets/...`); `getManifest` for chapters.
  `RecordingPage` works signed out (no delete).

## Tests

`shiur-player.test.tsx` renders the replay window with a fake API that has a manifest and a timeline with overlays; it fails on
the base at its first assertion (no bar). The recording journey (e2e) checks processing, a byte range and the bar's chapters in
Chromium.
