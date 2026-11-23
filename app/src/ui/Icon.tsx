// Social's icons (specs 023–027): one drawn set, 1.75px strokes on a 24px grid, sized 16–24px. Decorative unless a label is
// given; a button's text or aria-label names it.
import type { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  // Yasher koach: a raised flame of strength; filled when pressed.
  spark: (
    <path d="M12 3c.6 3 3.5 4.6 3.5 8.2A3.5 3.5 0 0 1 12 14.7a3.5 3.5 0 0 1-3.5-3.5c0-1.4.6-2.4 1.3-3.3M6.5 14a5.5 5.5 0 0 0 11 0" />
  ),
  sparkFilled: (
    <path
      d="M12 3c.6 3 3.5 4.6 3.5 8.2A3.5 3.5 0 0 1 12 14.7a3.5 3.5 0 0 1-3.5-3.5c0-1.4.6-2.4 1.3-3.3M6.5 14a5.5 5.5 0 0 0 11 0"
      fill="currentColor"
    />
  ),
  reply: <path d="M20 12a7.5 7.5 0 0 1-11 6.6L4 20l1.4-4.5A7.5 7.5 0 1 1 20 12Z" />,
  share: <path d="M12 15V3m0 0-4 4m4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />,
  trash: <path d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />,
  book: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15ZM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1m2 3.4a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  mail: <path d="M4 6h16v12H4zM4 7l8 6 8-6" />,
  chat: (
    <path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z M9 10.5c.4 1.9 2.1 3.6 4 4l1.3-1.3 2 .8-.5 1.7c-3.6.4-7.6-3.6-7.2-7.2l1.7-.5.8 2z" />
  ),
  arrowStart: <path d="M15 6l-6 6 6 6" />,
  check: <path d="M5 12.5 10 17l9-10" />,
  dots: <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth={3} />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
      data-icon={name}
    >
      {PATHS[name]}
    </svg>
  );
}
