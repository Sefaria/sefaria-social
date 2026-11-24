// A post that shares a follow-me link (spec 032): the source it shows is where the session's leader is now, not where the link
// was made. The card opens no socket (plan 4.5): while it is on screen and the tab is visible it asks the social API every
// LIVE_POLL_MS, and the server asks the relay at most once per session per few seconds for every viewer. "Join the shiur"
// opens the leader's place beside the feed, like any source link (contract 1.1 openBeside; a 1.0 reader goes there instead), with
// the link's `follow` parameter, which the reader's follow me joins on arrival; the text follows the leader in its pane.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useSocialApi, type FollowStatus, type Post } from "~/features/api/social-api";
import { useHost, useInterfaceLang } from "~/features/host/host-context";
import { ReaderRefLink, refWorkspace } from "~/features/host/ReaderRefLink";
import { useStrings } from "~/features/shell/use-strings";
import { withFollowParam } from "~/lib/follow-link";
import { Icon } from "~/ui/Icon";
import { SourceText, useNearViewport } from "~/ui/SourceText";
import styles from "./post.module.css";

/** How often a visible card asks where the session is. */
export const LIVE_POLL_MS = 10_000;

const pageVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

/** The follow session's status while the card is near the viewport and the tab is visible; null until the first answer. */
function useFollowStatus(postId: string, box: { current: Element | null }): FollowStatus | null {
  const api = useSocialApi();
  const near = useNearViewport(box);
  const [status, setStatus] = useState<FollowStatus | null>(null);
  useEffect(() => {
    if (!api || !near) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = async () => {
      timer = null;
      if (!pageVisible()) return; // resumed by visibilitychange
      try {
        const next = await api.followStatus(postId);
        if (alive) setStatus(next);
      } catch {
        // keep what was shown; try again next time
      }
      if (alive) timer = setTimeout(read, LIVE_POLL_MS);
    };
    const onVisible = () => {
      if (pageVisible() && timer === null) void read();
    };
    void read();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [api, near, postId]);
  return status;
}

export function LiveFollow({ post, sessionId }: { post: Post; sessionId: string }) {
  const t = useStrings();
  const lang = useInterfaceLang();
  const host = useHost();
  const box = useRef<HTMLElement>(null);
  const status = useFollowStatus(post.id, box);
  const live = status?.live === true;
  const ref = (live ? status.ref : null) ?? post.ref;

  const base = host ? (ref ? host.reader.commands.href(refWorkspace(ref)) : "/") : ref ? `/${ref.replace(/ /g, "_")}` : "/";
  const joinHref = withFollowParam(base, sessionId);
  const join = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!host || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    // beside the feed like any source (a history entry: Back, or the text's close, returns to the feed); a 1.0 reader goes there
    if (host.openBeside) host.openBeside(joinHref);
    else host.navigate(joinHref);
  };

  const state = status === null ? "waiting" : live ? "live" : "ended";
  return (
    <figure ref={box} className={`${styles.source} ${styles.follow}`} data-post-source={ref ?? ""} data-follow={state}>
      <figcaption className={styles.followHeader} aria-live="polite">
        {live ? (
          <>
            <span className={styles.followBadge}>
              <span className={styles.followDot} aria-hidden="true" />
              {t.followLive}
            </span>
            <span className={styles.followWho}>{status.away ? t.followAway(status.leader) : t.followLeading(status.leader)}</span>
            <span className={styles.followCount}>{t.cardLearning(status.participants)}</span>
          </>
        ) : status ? (
          <span className={styles.followWho}>{t.followEnded}</span>
        ) : null}
      </figcaption>
      {ref ? (
        <>
          <span className={styles.sourceRef}>
            <Icon name="book" size={16} />
            <ReaderRefLink textRef={ref} beside>
              {ref}
            </ReaderRefLink>
          </span>
          <SourceText textRef={ref} interfaceLang={lang} unavailableLabel={t.textUnavailable} />
        </>
      ) : null}
      {live ? (
        <a className={styles.followJoin} href={joinHref} onClick={join} data-follow-join="">
          {t.followJoin}
        </a>
      ) : null}
    </figure>
  );
}
