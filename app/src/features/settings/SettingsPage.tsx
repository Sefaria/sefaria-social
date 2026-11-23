import { Link } from "@tanstack/react-router";
import { ProfileForm } from "~/features/profile/ProfileForm";
import { SETTINGS_TABS, type SettingsTab } from "~/features/shell/social-routes";
import { useStrings } from "~/features/shell/use-strings";
import styles from "./settings.module.css";

/** `/social/settings`: social settings (R6), with the tab in the search (R7). A placeholder until the settings spec. */
export function SettingsPage({ tab }: { tab: SettingsTab | undefined }) {
  const t = useStrings();
  const current = tab ?? "profile";
  return (
    <main data-social-page="settings" className={styles.page}>
      <h1>{t.settings}</h1>
      <ul className={styles.tabs}>
        {SETTINGS_TABS.map((name) => (
          <li key={name}>
            <Link to="/social/settings" search={{ tab: name }} aria-current={name === current ? "page" : undefined} className={styles.tab}>
              {t.tabs[name]}
            </Link>
          </li>
        ))}
      </ul>
      <p data-settings-tab={current} className={styles.current}>
        {t.tabs[current]}
      </p>
      {current === "profile" ? <ProfileForm /> : <p>{t.placeholder}</p>}
    </main>
  );
}
