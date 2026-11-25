// The call's icons (spec 047): inline SVG, 20px, currentColor, aria-hidden — the buttons carry their names in text.
import type { ReactNode } from "react";

const svg = (children: ReactNode) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export const MicIcon = ({ off }: { off?: boolean }) =>
  svg(
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      {off && <path d="M4 4l16 16" />}
    </>,
  );

export const CameraIcon = ({ off }: { off?: boolean }) =>
  svg(
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3z" />
      {off && <path d="M3 3l18 18" />}
    </>,
  );

export const ScreenIcon = () =>
  svg(
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>,
  );

export const LeaveIcon = () => svg(<path d="M4 15c4-4 12-4 16 0l-2 3-3-1v-2a10 10 0 0 0-6 0v2l-3 1z" />);

/** Up to two initials from a display name ("Avi Owner" → "AO", "רבקה" → "ר"). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => [...w][0] ?? "");
  return letters.join("").toUpperCase() || "?";
}
