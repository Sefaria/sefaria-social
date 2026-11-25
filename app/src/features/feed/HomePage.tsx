// What `/social` renders (specs 015 and 023): spec 000's brand heading and diagnostic line, then two columns — the composer and
// the timeline (spec 023), and a rail with the viewer's rooms (spec 015, unchanged) and whom to follow (spec 025). One column on
// a phone, with the rooms above the timeline. Signed out, the rooms block asks the reader to sign in, as before. The social half
// loads as its own chunk, with skeletons until it arrives.
import { lazy, Suspense } from "react";
import { useSocialApi } from "~/features/api/social-api";
import { useViewer } from "~/features/host/use-viewer";
import { useStrings } from "~/features/shell/use-strings";
import kit from "~/ui/kit.module.css";
import { RoomsBar } from "~/features/rooms/RoomsBar";
import { Feed } from "./Feed";
import { FeedPage } from "./FeedPage";
import styles from "./home.module.css";

const HomeColumn = lazy(() => import("./HomeSocial").then((m) => ({ default: m.HomeColumn })));
const WhoToFollow = lazy(() => import("./HomeSocial").then((m) => ({ default: m.WhoToFollow })));

function ColumnSkeleton() {
  return (
    <div aria-hidden="true" className={styles.columnSkeleton}>
      <span className={kit.skeleton} style={{ blockSize: 96 }} />
      <span className={kit.skeleton} style={{ blockSize: 44 }} />
      <span className={kit.skeleton} style={{ blockSize: 120 }} />
      <span className={kit.skeleton} style={{ blockSize: 120 }} />
    </div>
  );
}

export function HomePage() {
  const t = useStrings();
  const viewer = useViewer();
  const api = useSocialApi();
  const signedIn = Boolean(viewer && api);
  return (
    <FeedPage>
      <div className={signedIn ? styles.home : `${styles.home} ${styles.signedOut}`} data-social-home="">
        {signedIn ? (
          <div className={styles.column}>
            <p className={styles.intro}>{t.homeIntro}</p>
            <Suspense fallback={<ColumnSkeleton />}>
              <HomeColumn />
            </Suspense>
          </div>
        ) : null}
        <aside className={styles.rooms} aria-label={t.feedLive}>
          <Feed />
          {signedIn ? <RoomsBar /> : null}
        </aside>
        {signedIn ? (
          <aside className={styles.follow} aria-label={t.whoToFollow}>
            <Suspense fallback={null}>
              <WhoToFollow />
            </Suspense>
          </aside>
        ) : null}
      </div>
    </FeedPage>
  );
}
