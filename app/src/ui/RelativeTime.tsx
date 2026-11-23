// A post's or reply's time (spec 023 AC-006): relative and short in the interface language ("5 min", "2 h", "3 Nov"), the
// full date and time in the <time> element's datetime and title.
import type { InterfaceLang } from "~/features/host/host-context";
import type { Strings } from "~/features/shell/strings";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relative(iso: string, now: number, t: Strings, lang: InterfaceLang): string {
  const at = Date.parse(iso);
  const ago = Math.max(0, now - at);
  if (ago < MINUTE) return t.justNow;
  if (ago < HOUR) return t.minutesAgo(Math.floor(ago / MINUTE));
  if (ago < DAY) return t.hoursAgo(Math.floor(ago / HOUR));
  if (ago < 7 * DAY) return t.daysAgo(Math.floor(ago / DAY));
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(lang === "hebrew" ? "he" : "en", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(at);
}

export function RelativeTime({ iso, t, lang, now = Date.now() }: { iso: string; t: Strings; lang: InterfaceLang; now?: number }) {
  const full = new Intl.DateTimeFormat(lang === "hebrew" ? "he" : "en", { dateStyle: "long", timeStyle: "short" }).format(
    Date.parse(iso),
  );
  return (
    <time dateTime={iso} title={full}>
      {relative(iso, now, t, lang)}
    </time>
  );
}
