// The feed (spec 015): the viewer's live rooms, upcoming shiurim and other rooms, as light cards (spec 016). One request to
// the social API, read again every 30 seconds while the page is open; no socket (plan 4.5). Signed out, it asks the reader
// to sign the person in (R17) and requests nothing.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useHost, useInterfaceLang } from "~/features/host/host-context";
import { useViewer } from "~/features/host/use-viewer";
import { langAttrs } from "~/features/shell/strings";
import { useStrings } from "~/features/shell/use-strings";
import { FeedCard, type CardItem } from "./FeedCard";
import { FeedPage } from "./FeedPage";
import { useFeedApi, type Feed as FeedData } from "./feed-api";
import styles from "./feed.module.css";

/** How often an open feed reads the API again. */
export const FEED_REFRESH_MS = 30_000;

type State = { kind: "loading" } | { kind: "ready"; feed: FeedData } | { kind: "error" };

export function Feed() {
  const t = useStrings();
  const lang = useInterfaceLang();
  const host = useHost();
  const viewer = useViewer();
  const api = useFeedApi();
  const [state, setState] = useState<State>({ kind: "loading" });
  const signedIn = Boolean(api && viewer);

  useEffect(() => {
    if (!api || !signedIn) return;
    let live = true;
    const read = () =>
      api.getFeed().then(
        (feed) => live && setState({ kind: "ready", feed }),
        // A failed refresh keeps what is shown; only a feed that never loaded becomes the error state.
        () => live && setState((s) => (s.kind === "ready" ? s : { kind: "error" })),
      );
    void read();
    const timer = setInterval(read, FEED_REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, signedIn, lang]);

  const signIn = useCallback(() => host?.viewer.requestSignIn(), [host]);

  return (
    <div
      className={styles.feed}
      data-social-page="feed"
      data-feed-state={signedIn ? state.kind : "signed-out"}
      {...langAttrs(lang)}
    >
      {!signedIn ? (
        <section className={styles.signedOut}>
          <p>{t.feedSignedOut}</p>
          <button type="button" onClick={signIn} data-action="sign-in">
            {t.signIn}
          </button>
        </section>
      ) : state.kind === "loading" ? (
        <p role="status">{t.loading}</p>
      ) : state.kind === "error" ? (
        <p role="alert">{t.feedError}</p>
      ) : (
        <>
          <Section
            id="live"
            title={t.feedLive}
            empty={t.feedLiveEmpty}
            items={state.feed.live.map((room) => ({ kind: "live", room }))}
          />
          <Section
            id="scheduled"
            title={t.feedScheduled}
            empty={t.feedScheduledEmpty}
            items={state.feed.scheduled.map((shiur) => ({ kind: "scheduled", shiur }))}
          />
          <Section
            id="recent"
            title={t.feedRecent}
            empty={t.feedRecentEmpty}
            items={state.feed.recent.map((room) => ({ kind: "recent", room }))}
          />
        </>
      )}
    </div>
  );
}

function Section({ id, title, empty, items }: { id: string; title: string; empty: string; items: CardItem[] }): ReactNode {
  const headingId = `social-feed-${id}`;
  return (
    <section className={styles.section} aria-labelledby={headingId} data-feed-section={id}>
      <h2 id={headingId} className={styles.sectionTitle}>
        {title}
      </h2>
      {items.length === 0 ? (
        <p className={styles.empty}>{empty}</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.kind === "scheduled" ? item.shiur.id : item.room.id}>
              <FeedCard item={item} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What `/social` renders in both route trees: the page frame of spec 000 with the feed inside it. */
export function FeedRoutePage() {
  return (
    <FeedPage>
      <Feed />
    </FeedPage>
  );
}
