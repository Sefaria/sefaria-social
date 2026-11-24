Feature folder: av (audio and video calls, specs 034–039). Imports `lib`, `ui` and `features`; never `server`. Only
`livekit-engine.ts` imports `livekit-client`, and only `load-livekit.ts` imports it (dynamically), so readers who never join a
call download none of it. See docs/ARCHITECTURE.md and docs/design/audio-video.md.
