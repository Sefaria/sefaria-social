// Who to follow (spec 025 AC-005): the rail's suggestions, institutions first, each with its avatar, name, a line of its bio and
// a Follow button; after following, the timeline reflects it on its next read.
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Profile } from "~/features/api/social-api";
import { useSocialApi } from "~/features/api/social-api";
import { useViewer } from "~/features/host/use-viewer";
import { useStrings } from "~/features/shell/use-strings";
import { Avatar } from "~/ui/Avatar";
import kit from "~/ui/kit.module.css";
import { FollowButton } from "./FollowButton";
import styles from "./profile.module.css";

export function WhoToFollow() {
  const t = useStrings();
  const api = useSocialApi();
  const viewer = useViewer();
  const [profiles, setProfiles] = useState<Profile[] | null>(null);

  useEffect(() => {
    if (!api || !viewer) return;
    let live = true;
    api.suggested().then(
      (p) => live && setProfiles(p),
      () => live && setProfiles([]),
    );
    return () => {
      live = false;
    };
  }, [api, viewer]);

  if (!viewer || !api) return null;
  return (
    <section className={styles.rail} aria-labelledby="who-to-follow" data-who-to-follow="">
      <h3 id="who-to-follow" className={styles.railTitle}>
        {t.whoToFollow}
      </h3>
      {profiles === null ? (
        <div aria-hidden="true" className={styles.railList}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={kit.skeleton} style={{ blockSize: 44 }} />
          ))}
        </div>
      ) : profiles.length === 0 ? (
        <p className={styles.railEmpty}>{t.whoToFollowEmpty}</p>
      ) : (
        <ul className={styles.railList}>
          {profiles.map((p) => (
            <li key={p.id} className={styles.suggestion} data-suggestion={p.id}>
              <Avatar id={p.id} name={p.name} kind={p.kind} size={40} />
              <span className={styles.suggestionText}>
                <Link to="/social/u/$profileId" params={{ profileId: p.id }} className={styles.suggestionName}>
                  {p.name}
                </Link>
                <span className={styles.suggestionMeta}>
                  {p.kind === "institution" ? `${t.institution} · ` : ""}
                  {t.followers(p.followers)}
                </span>
              </span>
              <FollowButton profileId={p.id} following={p.viewerFollows} name={p.name} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
