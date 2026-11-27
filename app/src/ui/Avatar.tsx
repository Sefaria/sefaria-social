// A profile's avatar (spec 025), drawn as presence (spec 060 AC-005): white, ringed in the person's cursor colour, the initials
// in ink. The colour is chosen from the profile's id, so the same person always looks the same, here and as their cursor in a
// room. The cursor set leaves out the Labs signals (teal is live, violet is a model). Institutions are rounded squares, people
// are circles. Decorative: the name next to it is the accessible label.
import type { CSSProperties } from "react";
import styles from "./kit.module.css";

/** The Labs cursor colours: each at 3:1 or more on white, none of them a signal colour. */
export const CURSOR_TONES = {
  gold: "#9a6f0a",
  blue: "#1e3f73",
  sky: "#2c6cb0",
  coral: "#b8452f",
  moss: "#4a7436",
  rose: "#a63e64",
} as const;
const TONES = Object.values(CURSOR_TONES);

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = [...words[0]!][0] ?? "";
  const last = words.length > 1 ? ([...words.at(-1)!][0] ?? "") : "";
  return (first + last).toUpperCase();
}

function toneOf(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length]!;
}

export function Avatar({
  id,
  name,
  kind,
  size = 40,
}: {
  id: string;
  name: string;
  kind: "person" | "institution";
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={kind === "institution" ? `${styles.avatar} ${styles.avatarInstitution}` : styles.avatar}
      style={
        { inlineSize: size, blockSize: size, "--avatar-tone": toneOf(id), fontSize: Math.round(size * 0.34) } as CSSProperties
      }
      data-avatar=""
    >
      {initials(name)}
    </span>
  );
}
