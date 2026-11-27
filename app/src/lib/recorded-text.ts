/** Reject reader navigation routes in recorded refs, including older manifests.
 * This is a route guard, not a replacement for the reader's canonical ref parser. */
export function isRecordedText(value: string): boolean {
  let path: string;
  try {
    path = decodeURIComponent(value.trim().split(/[?#]/)[0]!).replace(/^\/+|\/+$/g, "");
  } catch {
    return false;
  }
  if (!path || path.includes("/")) return false;
  return !/^(texts|topics|search|social|settings|profile|account|login|logout|register|saved|sheets|collections|calendars|my|notifications|history|about|help)$/i.test(
    path,
  );
}
