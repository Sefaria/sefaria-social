// A profile's avatar (spec 025): its initials on a colour chosen from its id, so the same person always looks the same.
// Institutions are rounded squares, people are circles. Decorative: the name next to it is the accessible label.
import styles from "./kit.module.css";

/** Ink tones that keep white initials above 4.5:1 contrast. */
const TONES = ["#18345d", "#4b5e8a", "#2f6f6a", "#7a4a2b", "#6b3f6e", "#3e5a2f", "#8a3b3b", "#35506b"];

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
      style={{ inlineSize: size, blockSize: size, background: toneOf(id), fontSize: Math.round(size * 0.38) }}
      data-avatar=""
    >
      {initials(name)}
    </span>
  );
}
