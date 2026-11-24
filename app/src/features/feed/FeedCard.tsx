// A light card (plan 4.5; spec 016): what a room is learning and who is there, or when a shiur starts. No reader, no socket:
// the status is what the server read from the relay for the feed. The card is an article labelled by its heading; the
// heading's link is the card's only link and is stretched over the whole card. Its href is the room's lobby or the shiur's
// page (R8, R15: built by the host, a plain click handed to the host). On a live room a plain click enlarges into the room
// instead (spec 018), and a press prepares the room's session first (spec 017 AC-004).
import { useId, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { useHost, useInterfaceLang } from "~/features/host/host-context";
import { refWorkspace } from "~/features/host/ReaderRefLink";
import { useRoomController } from "~/features/session/use-room-session";
import { langAttrs } from "~/features/shell/strings";
import { useStrings } from "~/features/shell/use-strings";
import { SourceText } from "~/ui/SourceText";
import { enlargeWithTransition, type TransitionEnv } from "./enlarge-transition";
import type { LiveRoom, RecentRoom, ScheduledShiur } from "./feed-api";
import styles from "./card.module.css";

export type CardItem =
  { kind: "live"; room: LiveRoom } | { kind: "recent"; room: RecentRoom } | { kind: "scheduled"; shiur: ScheduledShiur };

/** How long the view transition's update waits for the room's context before letting the transition finish (spec 018). */
export const ENTER_CAP_MS = 3_000;

const modified = (e: MouseEvent) => e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

export function FeedCard({ item, transitionEnv }: { item: CardItem; transitionEnv?: TransitionEnv }) {
  const t = useStrings();
  const lang = useInterfaceLang();
  const host = useHost();
  const { controller } = useRoomController();
  const article = useRef<HTMLElement>(null);
  const headingId = useId();

  const id = item.kind === "scheduled" ? item.shiur.id : item.room.id;
  const title = item.kind === "scheduled" ? item.shiur.title : item.room.title;
  const path = item.kind === "scheduled" ? `/social/s/${id}` : `/social/r/${id}`;
  const ref = item.kind === "live" ? item.room.ref : item.kind === "scheduled" ? item.shiur.ref : null;
  const heRef = item.kind === "live" ? item.room.heRef : null;
  const live = item.kind === "live";
  const shownRef =
    lang === "hebrew" && heRef ? { text: heRef, attrs: langAttrs("hebrew") } : { text: ref, attrs: langAttrs("english") };

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!host || e.defaultPrevented || modified(e)) return; // modified clicks stay links (spec 018 AC-004)
    e.preventDefault();
    if (!live || !controller || !article.current) {
      host.navigate(path);
      return;
    }
    const fallbackUrl = ref ? host.reader.commands.href(refWorkspace(ref)) : undefined;
    void enlargeWithTransition(
      article.current,
      async () => {
        await controller.enlarge(id, { fallbackUrl });
        await controller.whenEntered(id, ENTER_CAP_MS);
      },
      transitionEnv,
    );
  };
  const onPointerDown = (e: PointerEvent<HTMLAnchorElement>) => {
    if (live && e.button === 0) controller?.prefetch(id);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLAnchorElement>) => {
    if (live && (e.key === "Enter" || e.key === " ")) controller?.prefetch(id);
  };

  return (
    <article
      ref={article}
      className={styles.card}
      aria-labelledby={headingId}
      data-feed-card={item.kind}
      data-id={id}
      data-ref={ref ?? undefined}
    >
      <h3 id={headingId} className={styles.heading}>
        <a
          className={styles.link}
          href={host ? host.href(path) : path}
          onClick={onClick}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
        >
          <bdi dir="auto">{title}</bdi>
        </a>
      </h3>
      <p className={styles.status} data-card-status={item.kind}>
        {live && <span className={styles.dot} aria-hidden="true" />}
        <Status item={item} lang={lang} t={t} />
      </p>
      {shownRef.text && (
        <p className={styles.where} {...shownRef.attrs} data-card-ref="">
          {shownRef.text}
        </p>
      )}
      {ref && <SourceText textRef={ref} interfaceLang={lang} unavailableLabel={t.textUnavailable} />}
    </article>
  );
}

function Status({ item, lang, t }: { item: CardItem; lang: "english" | "hebrew"; t: ReturnType<typeof useStrings> }) {
  if (item.kind === "live")
    return (
      <>
        <span className={styles.live}>{t.cardLive}</span>
        <span aria-hidden="true"> · </span>
        <span>{t.cardLearning(item.room.participants)}</span>
        {item.room.call?.live && (
          <>
            <span aria-hidden="true"> · </span>
            <span data-call-count="">{t.onCall(item.room.call.participants)}</span>
          </>
        )}
      </>
    );
  if (item.kind === "recent")
    return (
      <>
        <span>{t.cardNotLive}</span>
        {item.room.call?.live && (
          <>
            <span aria-hidden="true"> · </span>
            <span data-call-count="">{t.onCall(item.room.call.participants)}</span>
          </>
        )}
      </>
    );
  const when = new Intl.DateTimeFormat(lang === "hebrew" ? "he" : "en", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(item.shiur.scheduledAt),
  );
  return (
    <>
      <span>{t.cardShiur}</span>
      <span aria-hidden="true"> · </span>
      <time dateTime={item.shiur.scheduledAt}>{t.cardStarts(when)}</time>
    </>
  );
}
