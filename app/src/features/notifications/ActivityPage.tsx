// `/social/notifications`, titled "Activity" (spec 026 AC-004): each notification as a sentence in the interface language,
// unread ones marked with a dot and bold text, each opening straight to the post or profile it is about. Showing the page marks
// everything read and clears the badge.
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Notification } from "~/features/api/social-api";
import { useSocialApi } from "~/features/api/social-api";
import { useHost, useInterfaceLang } from "~/features/host/host-context";
import { useViewer } from "~/features/host/use-viewer";
import { langAttrs, type Strings } from "~/features/shell/strings";
import { useStrings } from "~/features/shell/use-strings";
import { Avatar } from "~/ui/Avatar";
import kit from "~/ui/kit.module.css";
import { RelativeTime } from "~/ui/RelativeTime";
import styles from "./activity.module.css";
import { setUnread } from "./use-unread";

type State = { kind: "loading" } | { kind: "ready"; items: Notification[] } | { kind: "error" };

export function sentence(n: Notification, t: Strings): string {
  const who = n.actor?.name ?? t.someone;
  switch (n.kind) {
    case "follow":
      return t.nFollow(who);
    case "reply":
      return t.nReply(who);
    case "reaction":
      return t.nReaction(who);
    default:
      return t.nPost(who);
  }
}

export function ActivityPage() {
  const t = useStrings();
  const lang = useInterfaceLang();
  const api = useSocialApi();
  const viewer = useViewer();
  const host = useHost();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!api || !viewer) return;
    let live = true;
    api.notifications().then(
      (list) => {
        if (!live) return;
        setState({ kind: "ready", items: list.notifications });
        if (list.unread > 0)
          void api.readNotifications().then(
            () => setUnread(api, 0),
            () => undefined,
          );
      },
      () => live && setState({ kind: "error" }),
    );
    return () => {
      live = false;
    };
  }, [api, viewer]);

  return (
    <main data-social-page="activity" className={styles.page} {...langAttrs(lang)}>
      <h1 className={styles.title}>{t.activityTitle}</h1>
      {!viewer ? (
        <div className={kit.empty}>
          <p className={kit.emptyBody}>{t.feedSignedOut}</p>
          <button
            type="button"
            className={`${kit.button} ${kit.primary}`}
            onClick={() => host?.viewer.requestSignIn()}
            data-action="sign-in"
          >
            {t.signIn}
          </button>
        </div>
      ) : state.kind === "loading" ? (
        <p role="status">{t.loading}</p>
      ) : state.kind === "error" ? (
        <p role="alert">{t.activityError}</p>
      ) : state.items.length === 0 ? (
        <div className={kit.empty} data-activity-empty="">
          <p className={kit.emptyBody}>{t.activityEmpty}</p>
        </div>
      ) : (
        <ul className={styles.list} data-activity-list="">
          {state.items.map((n) => (
            <li
              key={n.id}
              className={n.read ? styles.item : `${styles.item} ${styles.unread}`}
              data-notification={n.kind}
              data-read={n.read ? "true" : "false"}
            >
              {n.actor ? <Avatar id={n.actor.id} name={n.actor.name} kind="person" size={36} /> : <span />}
              <div className={styles.text}>
                {n.post && n.kind !== "follow" ? (
                  <Link to="/social/p/$postId" params={{ postId: n.post.id }} className={styles.link}>
                    {sentence(n, t)}
                  </Link>
                ) : n.actor ? (
                  <Link to="/social/u/$profileId" params={{ profileId: n.actor.id }} className={styles.link}>
                    {sentence(n, t)}
                  </Link>
                ) : (
                  <span>{sentence(n, t)}</span>
                )}
                {n.post ? (
                  <span className={styles.snippet} dir="auto">
                    {n.post.snippet}
                  </span>
                ) : null}
                <span className={styles.time}>
                  <RelativeTime iso={n.createdAt} t={t} lang={lang} />
                </span>
              </div>
              {!n.read ? <span className={styles.dot} aria-label={t.unread(1)} /> : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
