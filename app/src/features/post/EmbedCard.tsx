// A post's session card (spec 055 AC-005): the room, broadcast or recording a post links to, with its title, its leader and one
// button — Join, Watch or Play — whose href the host builds and whose plain click the host handles (R8). A target that no longer
// exists says so and has no button. In the composer (AC-001) the same card shows the pasted link with Remove. A room's or
// broadcast's card is live (spec 056 AC-004): while on screen it shows Live, how many are there, the leader's ref and that
// text, or Not live with the last ref the relay reported.
import { useId, useRef, type MouseEvent } from "react";
import { useHost, useInterfaceLang } from "~/features/host/host-context";
import { langAttrs } from "~/features/shell/strings";
import { useStrings } from "~/features/shell/use-strings";
import { SourceText } from "~/ui/SourceText";
import kit from "~/ui/kit.module.css";
import { embedPath, type EmbedKind } from "./embed-link";
import { useLiveStatus, type LiveStatus } from "./live-status";
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

/** The live part of a room's or broadcast's card. */
function LiveLine({ status }: { status: LiveStatus }) {
  const t = useStrings();
  const lang = useInterfaceLang();
  const shown =
    lang === "hebrew" && status.heRef
      ? { text: status.heRef, attrs: langAttrs("hebrew") }
      : { text: status.ref, attrs: langAttrs("english") };
  return (
    <>
      <p className={styles.status} data-embed-status={status.live ? "live" : "not-live"}>
        {status.live ? (
          <>
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.live}>{t.cardLive}</span>
            <span aria-hidden="true">·</span>
            <span>{t.cardLearning(status.here)}</span>
          </>
        ) : (
          <span>{t.cardNotLive}</span>
        )}
      </p>
      {shown.text ? (
        <p className={styles.where} {...shown.attrs} data-embed-ref={status.ref ?? ""}>
          {shown.text}
        </p>
      ) : null}
      {status.live && status.ref ? (
        <SourceText key={status.ref} textRef={status.ref} interfaceLang={lang} unavailableLabel={t.textUnavailable} />
      ) : null}
    </>
  );
}

export function EmbedCard({ embed }: { embed: Embed }) {
  const t = useStrings();
  const host = useHost();
  const box = useRef<HTMLElement>(null);
  const titleId = useId();
  const status = useLiveStatus(embed.kind === "recording" || embed.title === null ? null : embed.id, box);
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
      ref={box}
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
          <p id={titleId} className={styles.title} dir="auto" data-embed-title="">
            {embed.title}
          </p>
          {embed.leader ? (
            <p className={styles.leader} dir="auto" data-embed-leader="">
              {t.embedWith(embed.leader)}
            </p>
          ) : null}
          {status ? <LiveLine status={status} /> : null}
          <div className={styles.actions}>
            <a
              className={`${kit.button} ${kit.primary} ${kit.small} ${styles.action}`}
              href={host ? host.href(path) : path}
              aria-describedby={titleId}
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
          aria-label={t.embedRemoveLabel(t.embedKind[kind])}
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
