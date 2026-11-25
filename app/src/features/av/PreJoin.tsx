import { useEffect, useRef, useSyncExternalStore } from "react";
import { useStrings } from "~/features/shell/use-strings";
import { recordingHere, useRecordingController, useRecordingView, useRoomRecording } from "~/features/recording/use-recording";
import type { CallController } from "./call-controller";
import { callRoom, type DeviceChoice } from "./machine";
import { CameraIcon, MicIcon } from "./icons";
import styles from "./av.module.css";

/**
 * The pre-join step (spec 034 AC-004, AC-005): microphone and camera start off, device choosers, the camera preview once the
 * camera is on, Join. When the browser refuses the devices, it says how to allow them and offers "Join to listen".
 */
export function PreJoin({ controller, devices }: { controller: CallController; devices: DeviceChoice }) {
  const t = useStrings();
  const list = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.deviceList(),
    () => null,
  );
  const preview = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.preview(),
    () => null,
  );
  const video = useRef<HTMLVideoElement>(null);
  const roomId = callRoom(controller.view());
  const recordedHere = recordingHere(useRecordingView(useRecordingController()), roomId ?? "");
  const recorded = useRoomRecording(roomId) || recordedHere;
  useEffect(() => {
    if (!preview || !video.current) return;
    return preview.attach(video.current);
  }, [preview]);

  const set = (patch: Partial<DeviceChoice>) => controller.choose({ ...devices, ...patch });
  const denied = devices.permission === "denied";
  const listenOnly = denied && !devices.mic && !devices.camera;

  return (
    <div className={styles.prejoin}>
      {recorded && (
        <p role="note" data-recording-notice="">
          {t.beingRecorded}
        </p>
      )}
      <div className={styles.previewBox} data-preview-box="">
        {devices.camera && preview ? (
          <video ref={video} data-preview="" className={styles.preview} aria-label={t.yourCamera} autoPlay muted playsInline />
        ) : (
          <span className={styles.previewOff}>{t.cameraIsOff}</span>
        )}
        <div className={styles.overlay}>
          <div className={styles.toggles}>
            <button
              type="button"
              data-action="toggle-mic"
              aria-pressed={devices.mic}
              className={styles.round}
              title={t.microphone}
              onClick={() => set({ mic: !devices.mic })}
            >
              <MicIcon off={!devices.mic} />
              <span className={styles.label}>{t.microphone}</span>
            </button>
            <button
              type="button"
              data-action="toggle-camera"
              aria-pressed={devices.camera}
              className={styles.round}
              title={t.camera}
              onClick={() => set({ camera: !devices.camera })}
            >
              <CameraIcon off={!devices.camera} />
              <span className={styles.label}>{t.camera}</span>
            </button>
          </div>
          <div className={styles.actions}>
            <button type="button" data-action="join-now" className={styles.primary} onClick={() => void controller.join()}>
              {listenOnly ? t.joinToListen : t.joinNow}
            </button>
            <button type="button" data-action="cancel-call" className={styles.ghost} onClick={() => controller.cancel()}>
              {t.cancel}
            </button>
          </div>
        </div>
      </div>
      {list && (
        <div className={styles.devices}>
          <label>
            {t.microphoneDevice}
            <select
              data-device="audio"
              value={devices.audioDeviceId ?? ""}
              onChange={(e) => set({ audioDeviceId: e.target.value || null })}
            >
              {list.audioInputs.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `${t.microphone} ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.cameraDevice}
            <select
              data-device="video"
              value={devices.videoDeviceId ?? ""}
              onChange={(e) => set({ videoDeviceId: e.target.value || null })}
            >
              {list.videoInputs.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `${t.camera} ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {denied && (
        <p role="alert" data-permission="denied">
          {t.permissionDenied}
        </p>
      )}
    </div>
  );
}
