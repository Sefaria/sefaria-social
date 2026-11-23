import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useInterfaceLang } from "~/features/host/host-context";
import { langAttrs, stringsFor } from "./strings";
import styles from "./shell.module.css";

/** Social's frame inside the page mount (and the standalone pages): its own nav and the current page. */
export function SocialLayout({ children }: { children: ReactNode }) {
  const lang = useInterfaceLang();
  const t = stringsFor(lang);
  return (
    <div className={styles.frame} data-social-root="" {...langAttrs(lang)}>
      <nav className={styles.nav} aria-label={t.nav}>
        <Link to="/social" className={styles.navLink} activeOptions={{ exact: true }}>
          {t.feed}
        </Link>
        <Link to="/social/settings" className={styles.navLink}>
          {t.settings}
        </Link>
      </nav>
      {children}
    </div>
  );
}
