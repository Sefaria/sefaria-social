// `/social/u/$profileId` (spec 025 AC-005): a person or an institution — name, kind, bio, counts, Follow (or, on one's own
// profile, a link to edit it), and its posts.
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ProfileWithPosts } from "~/features/api/social-api";
import { SocialApiError, useSocialApi } from "~/features/api/social-api";
import { useHost, useInterfaceLang } from "~/features/host/host-context";
import { useViewer } from "~/features/host/use-viewer";
import { PostCard } from "~/features/post/PostCard";
import { ShareMenu } from "~/features/share/ShareMenu";
import { langAttrs } from "~/features/shell/strings";
import { useStrings } from "~/features/shell/use-strings";
import { Avatar } from "~/ui/Avatar";
import kit from "~/ui/kit.module.css";
import { FollowButton } from "./FollowButton";
import styles from "./profile.module.css";

type State = { kind: "loading" } | { kind: "ready"; data: ProfileWithPosts } | { kind: "missing" } | { kind: "error" };

export function ProfilePage({ profileId }: { profileId: string }) {
  const t = useStrings();
  const lang = useInterfaceLang();
  const api = useSocialApi();
  const viewer = useViewer();
  const host = useHost();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!api || !viewer) return;
    let live = true;
    setState({ kind: "loading" });
    api.profile(profileId).then(
      (data) => live && setState({ kind: "ready", data }),
      (e: unknown) => live && setState({ kind: e instanceof SocialApiError && e.status === 404 ? "missing" : "error" }),
    );
    return () => {
      live = false;
    };
  }, [api, viewer, profileId]);

  const followChanged = ({ following, followers }: { following: boolean; followers: number | null }) =>
    setState((s) => {
      if (s.kind !== "ready") return s;
      const p = s.data.profile;
      const count = followers ?? Math.max(0, p.followers + (following === p.viewerFollows ? 0 : following ? 1 : -1));
      return { kind: "ready", data: { ...s.data, profile: { ...p, viewerFollows: following, followers: count } } };
    });

  if (!viewer)
    return (
      <main data-social-page="profile" {...langAttrs(lang)}>
        <h1>{t.myProfile}</h1>
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
      </main>
    );

  if (state.kind === "loading")
    return (
      <main data-social-page="profile" {...langAttrs(lang)}>
        <h1 className={kit.visuallyHidden}>{t.myProfile}</h1>
        <p role="status">{t.loading}</p>
      </main>
    );

  if (state.kind === "missing" || state.kind === "error")
    return (
      <main data-social-page="profile" {...langAttrs(lang)}>
        <h1>{state.kind === "missing" ? t.notFoundTitle : t.myProfile}</h1>
        <p role={state.kind === "error" ? "alert" : undefined} data-profile-missing={state.kind === "missing" ? "" : undefined}>
          {state.kind === "missing" ? t.profileNotFound : t.profileError}
        </p>
        <Link to="/social" className={`${kit.button} ${kit.secondary}`}>
          {t.backToFeed}
        </Link>
      </main>
    );

  const { profile, posts } = state.data;
  return (
    <main data-social-page="profile" className={styles.page} data-profile={profile.id} {...langAttrs(lang)}>
      <header className={styles.hero}>
        <Avatar id={profile.id} name={profile.name} kind={profile.kind} size={88} />
        <div className={styles.heroText}>
          <h1 className={styles.name} dir="auto">
            {profile.name}
          </h1>
          {profile.kind === "institution" ? <span className={kit.badge}>{t.institution}</span> : null}
          {profile.bio ? (
            <p className={styles.bio} dir="auto" data-profile-bio="">
              {profile.bio}
            </p>
          ) : null}
          <p className={styles.counts}>
            <span data-profile-followers="">{t.followers(profile.followers)}</span>
            {profile.kind === "person" ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{t.followingCount(profile.following)}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className={styles.heroActions}>
          {profile.isOwn ? (
            <Link
              to="/social/settings"
              search={{ tab: "profile" }}
              className={`${kit.button} ${kit.secondary} ${kit.small}`}
              data-action="edit-profile"
            >
              {t.editProfile}
            </Link>
          ) : (
            <FollowButton profileId={profile.id} following={profile.viewerFollows} onChange={followChanged} name={profile.name} />
          )}
          <ShareMenu path={`/social/u/${profile.id}`} text={profile.bio ? `${profile.name}: ${profile.bio}` : profile.name} />
        </div>
      </header>
      <section aria-labelledby="profile-posts" className={styles.posts}>
        <h2 id="profile-posts" className={styles.postsTitle}>
          {t.profilePostsTitle}
        </h2>
        {posts.length === 0 ? (
          <p className={styles.railEmpty}>{t.profileNoPosts}</p>
        ) : (
          <ul className={styles.postList}>
            {posts.map((p) => (
              <li key={p.id}>
                <PostCard post={p} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
