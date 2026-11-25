// The room owner's last microphone and camera choice, for the next room they start or enter (spec 049 AC-006). Kept in
// localStorage, read and written in try/catch: private windows and blocked storage fall back to the first-time default.
// An invitee never reads it: they always start with both off (docs/plans/shiur.md D6).

export interface CallChoice {
  mic: boolean;
  camera: boolean;
}

const KEY = "social.callDevices";
/** The first time (proposed in spec 049): the person starting a session talks, so the microphone is on; the camera is off. */
export const FIRST_TIME: CallChoice = { mic: true, camera: false };
export const BOTH_OFF: CallChoice = { mic: false, camera: false };

export function rememberedChoice(): CallChoice {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    if (!raw) return FIRST_TIME;
    const v = JSON.parse(raw) as Partial<CallChoice>;
    return typeof v.mic === "boolean" && typeof v.camera === "boolean" ? { mic: v.mic, camera: v.camera } : FIRST_TIME;
  } catch {
    return FIRST_TIME;
  }
}

export function rememberChoice(patch: Partial<CallChoice>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...rememberedChoice(), ...patch }));
  } catch {
    // the choice lasts for this call only
  }
}
