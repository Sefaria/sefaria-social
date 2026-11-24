// The timeline (spec 023 AC-002, AC-004; spec 031): Following (the default; newest first, with the network's reposts) and For you
// (ranked for the viewer), 20 at a time with "Show more"; skeleton rows while the first page loads, an invitation when there is
// nothing to show, and an alert when it cannot load. A post or quote the viewer just wrote appears at the top at once.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Post, TimelineTab } from "~/features/api/social-api";
import { useSocialApi } from "~/features/api/social-api";
import { useInterfaceLang } from "~/features/host/host-context";
import { langAttrs } from "~/features/shell/strings";
import { useStrings } from "~/features/shell/use-strings";
import kit from "~/ui/kit.module.css";
import { PostCard, PostSkeleton } from "./PostCard";
import styles from "./timeline.module.css";

type State = { kind: "loading" } | { kind: "ready"; posts: Post[]; next: string | null; more: boolean } | { kind: "error" };

export const TIMELINE_TABS: readonly TimelineTab[] = ["following", "everyone"];

export function Timeline({ latest }: { latest: Post | null }) {
  const t = useStrings();
  const lang = useInterfaceLang();
  const api = useSocialApi();
  const [tab, setTab] = useState<TimelineTab>("following");
  const [state, setState] = useState<State>({ kind: "loading" });
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!api) return;
    let live = true;
    setState({ kind: "loading" });
    api.timeline(tab).then(
      (page) => live && setState({ kind: "ready", posts: page.posts, next: page.nextCursor, more: false }),
      () => live && setState({ kind: "error" }),
    );
    return () => {
      live = false;
    };
  }, [api, tab]);

  const prepend = useCallback(
    (post: Post) =>
      setState((s) => (s.kind === "ready" && !s.posts.some((p) => p.id === post.id) ? { ...s, posts: [post, ...s.posts] } : s)),
    [],
  );
  useEffect(() => {
    if (latest) prepend(latest);
  }, [latest, prepend]);

  const showMore = useCallback(async () => {
    if (!api || state.kind !== "ready" || !state.next) return;
    setState({ ...state, more: true });
    try {
      const page = await api.timeline(tab, state.next);
      setState((s) =>
        s.kind === "ready" ? { kind: "ready", posts: [...s.posts, ...page.posts], next: page.nextCursor, more: false } : s,
      );
    } catch {
      setState((s) => (s.kind === "ready" ? { ...s, more: false } : s));
    }
  }, [api, state, tab]);

  const removed = (id: string) => setState((s) => (s.kind === "ready" ? { ...s, posts: s.posts.filter((p) => p.id !== id) } : s));

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const forward = (e.key === "ArrowRight") !== (lang === "hebrew");
    const next = (i + (forward ? 1 : -1) + TIMELINE_TABS.length) % TIMELINE_TABS.length;
    setTab(TIMELINE_TABS[next]!);
    tabRefs.current[next]?.focus();
  };

  const label = (x: TimelineTab) => (x === "following" ? t.tabFollowing : t.tabEveryone);
  return (
    <section
      className={styles.timeline}
      aria-label={t.timelineLabel}
      data-timeline={tab}
      data-timeline-state={state.kind}
      {...langAttrs(lang)}
    >
      <div role="tablist" className={`${kit.tabs} ${styles.tabs}`} aria-label={t.timelineLabel}>
        {TIMELINE_TABS.map((x, i) => (
          <button
            key={x}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`timeline-tab-${x}`}
            aria-selected={tab === x}
            aria-controls="timeline-panel"
            tabIndex={tab === x ? 0 : -1}
            className={kit.tab}
            onClick={() => setTab(x)}
            onKeyDown={(e) => onTabKey(e, i)}
            data-timeline-tab={x}
          >
            {label(x)}
          </button>
        ))}
      </div>
      <div id="timeline-panel" role="tabpanel" aria-labelledby={`timeline-tab-${tab}`}>
        {state.kind === "loading" ? (
          <div role="status" aria-label={t.loading}>
            <PostSkeleton />
            <PostSkeleton />
            <PostSkeleton />
          </div>
        ) : state.kind === "error" ? (
          <p role="alert" className={styles.error}>
            {t.timelineError}
          </p>
        ) : state.posts.length === 0 ? (
          <div className={kit.empty} data-timeline-empty="">
            <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true" className={styles.emptyArt}>
              <rect x="14" y="12" width="44" height="50" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M24 26h24M24 34h24M24 42h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {tab === "following" ? (
              <>
                <p className={kit.emptyTitle}>{t.timelineEmptyTitle}</p>
                <p className={kit.emptyBody}>{t.timelineEmptyBody}</p>
                <button type="button" className={`${kit.button} ${kit.secondary}`} onClick={() => setTab("everyone")}>
                  {t.tabEveryone}
                </button>
              </>
            ) : (
              <p className={kit.emptyBody}>{t.timelineEveryoneEmpty}</p>
            )}
          </div>
        ) : (
          <>
            <ul className={styles.list} data-timeline-list="">
              {state.posts.map((p) => (
                <li key={p.id}>
                  <PostCard post={p} onDeleted={removed} onQuoted={prepend} />
                </li>
              ))}
            </ul>
            {state.next ? (
              <div className={styles.more}>
                <button
                  type="button"
                  className={`${kit.button} ${kit.secondary}`}
                  onClick={() => void showMore()}
                  disabled={state.more}
                  data-action="show-more"
                >
                  {state.more ? t.loading : t.showMore}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
