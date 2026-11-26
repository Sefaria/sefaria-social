// ffmpeg and ffprobe for asset processing (spec 052): run with an argument list (never a shell) and a time limit, from the
// server image's own binaries (Dockerfile) or FFMPEG_PATH / FFPROBE_PATH.
import { execFile } from "node:child_process";

export const FFMPEG_TIMEOUT_MS = 10 * 60_000;

function run(bin: string, args: readonly string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, [...args], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${bin} failed: ${String(stderr).slice(-500) || err.message}`));
      else resolve(String(stdout));
    });
  });
}

export const ffmpeg = (args: readonly string[], timeoutMs = FFMPEG_TIMEOUT_MS) =>
  run(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", ...args], timeoutMs);

/** The streams' kinds and the container's duration in ms. */
export async function probe(file: string): Promise<{ durationMs: number; video: boolean; audio: boolean }> {
  const out = await run(
    process.env.FFPROBE_PATH || "ffprobe",
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file],
    60_000,
  );
  const json = JSON.parse(out) as { format?: { duration?: string }; streams?: { codec_type?: string }[] };
  const kinds = new Set((json.streams ?? []).map((s) => s.codec_type));
  return {
    durationMs: Math.round(Number(json.format?.duration ?? 0) * 1000),
    video: kinds.has("video"),
    audio: kinds.has("audio"),
  };
}
