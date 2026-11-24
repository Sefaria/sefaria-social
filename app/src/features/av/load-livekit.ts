// The only way to the LiveKit engine: a dynamic import, so livekit-client is its own chunk that the browser fetches when a
// viewer opens the pre-join step, never before (spec 034 AC-003).
import type { LoadEngine } from "./media";

export const loadLiveKit: LoadEngine = () => import("./livekit-engine").then((m) => m.createLiveKitEngine());
