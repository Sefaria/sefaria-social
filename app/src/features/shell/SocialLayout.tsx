import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useInterfaceLang } from "~/features/host/host-context";
import { useViewer } from "~/features/host/use-viewer";
import { useUnread } from "~/features/notifications/use-unread";
import { useMe } from "~/features/profile/use-me";
import kit from "~/ui/kit.module.css";
import { langAttrs, stringsFor } from "./strings";
import styles from "./shell.module.css";

/**
 * Social's frame inside the page mount (and the standalone pages): its own nav and the current page. Signed in, the nav adds
 * Activity with its unread badge (spec 026) and the viewer's profile (spec 025).
 */
export function SocialLayout({ children }: { children: ReactNode }) {
  const lang = useInterfaceLang();
  const t = stringsFor(lang);
  const viewer = useViewer();
  return (
    <div className={styles.frame} data-social-root="" {...langAttrs(lang)}>
      <nav className={styles.nav} aria-label={t.nav}>
        <Link to="/social" className={styles.navLink} activeOptions={{ exact: true }}>
          {t.feed}
        </Link>
        {viewer ? <SignedInLinks /> : null}
        <Link to="/social/settings" className={styles.navLink}>
          {t.settings}
        </Link>
      </nav>
      {children}
    </div>
  );
}

function SignedInLinks() {
  const lang = useInterfaceLang();
  const t = stringsFor(lang);
  const unread = useUnread();
  const me = useMe();
  return (
    <>
      <Link
        to="/social/notifications"
        className={styles.navLink}
        data-nav="activity"
        aria-label={unread > 0 ? `${t.activity}, ${t.unread(unread)}` : undefined}
      >
        {t.activity}
        {unread > 0 ? (
          <span className={kit.count} aria-hidden="true" data-unread={unread}>
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </Link>
      {me ? (
        <Link to="/social/u/$profileId" params={{ profileId: me.id }} className={styles.navLink} data-nav="profile">
          {t.myProfile}
        </Link>
      ) : null}
    </>
  );
}
