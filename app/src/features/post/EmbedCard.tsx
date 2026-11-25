// A post's session card (spec 055 AC-005): the room, broadcast or recording a post links to, with its title, its leader and one
// button — Join, Watch or Play — whose href the host builds and whose plain click the host handles (R8). A target that no longer
// exists says so and has no button. In the composer (AC-001) the same card shows the pasted link with Remove.
import type { MouseEvent, ReactNode } from "react";
import { useHost } from "~/features/host/host-context";
import { useStrings } from "~/features/shell/use-strings";
import kit from "~/ui/kit.module.css";
import { embedPath, type EmbedKind } from "./embed-link";
import styles from "./embed-card.module.css";

export interface Embed {
  kind: EmbedKind;
  id: string;
  title: string | null;
  leader: string | null;
}

const modified = (e: MouseEvent) => e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

function KindLabel({ kind }: { kind: EmbedKind }) {
  const t = useStrings();
  return <span className={styles.kind}>{t.embedKind[kind]}</span>;
}

export function EmbedCard({ embed, children }: { embed: Embed; children?: ReactNode }) {
  const t = useStrings();
  const host = useHost();
  const path = embedPath(embed.kind, embed.id);
  const available = embed.title !== null;
  const label = embed.kind === "room" ? t.embedJoin : embed.kind === "broadcast" ? t.embedWatch : t.embedPlay;
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!host || e.defaultPrevented || modified(e)) return; // a modified click stays the browser's
    e.preventDefault();
    host.navigate(path);
  };
  return (
    <section
      className={styles.card}
      aria-label={available ? `${t.embedKind[embed.kind]}: ${embed.title}` : t.embedUnavailable}
      data-embed-card={embed.kind}
      data-embed-id={embed.id}
      data-embed-unavailable={available ? undefined : ""}
    >
      <div className={styles.head}>
        <KindLabel kind={embed.kind} />
      </div>
      {available ? (
        <>
          <p className={styles.title} dir="auto" data-embed-title="">
            {embed.title}
          </p>
          {embed.leader ? (
            <p className={styles.leader} dir="auto" data-embed-leader="">
              {t.embedWith(embed.leader)}
            </p>
          ) : null}
          {children}
          <div className={styles.actions}>
            <a
              className={`${kit.button} ${kit.primary} ${kit.small} ${styles.action}`}
              href={host ? host.href(path) : path}
              onClick={onClick}
              data-embed-action={embed.kind}
            >
              {label}
            </a>
          </div>
        </>
      ) : (
        <p className={styles.muted}>{t.embedUnavailable}</p>
      )}
    </section>
  );
}

/** The card in the composer (spec 055 AC-001): the kind and the link as pasted, with Remove. */
export function DraftEmbedCard({ kind, text, onRemove }: { kind: EmbedKind; text: string; onRemove: () => void }) {
  const t = useStrings();
  return (
    <section className={styles.card} aria-label={t.embedKind[kind]} data-composer-embed={kind}>
      <div className={styles.head}>
        <KindLabel kind={kind} />
        <button
          type="button"
          className={`${kit.button} ${kit.ghost} ${kit.small} ${styles.push}`}
          onClick={onRemove}
          data-action="remove-embed"
        >
          {t.embedRemove}
        </button>
      </div>
      <p className={styles.link} dir="ltr">
        {text}
      </p>
    </section>
  );
}
