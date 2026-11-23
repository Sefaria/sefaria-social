import { Link } from "@tanstack/react-router";
import { SETTINGS_TABS, type SettingsTab } from "~/features/shell/social-routes";
import { useStrings } from "~/features/shell/use-strings";

/** `/social/settings`: social settings (R6), with the tab in the search (R7). A placeholder until the settings spec. */
export function SettingsPage({ tab }: { tab: SettingsTab | undefined }) {
  const t = useStrings();
  const current = tab ?? "profile";
  return (
    <main data-social-page="settings">
      <h1>{t.settings}</h1>
      <ul>
        {SETTINGS_TABS.map((name) => (
          <li key={name}>
            <Link to="/social/settings" search={{ tab: name }} aria-current={name === current ? "page" : undefined}>
              {t.tabs[name]}
            </Link>
          </li>
        ))}
      </ul>
      <p data-settings-tab={current}>{t.tabs[current]}</p>
      <p>{t.placeholder}</p>
    </main>
  );
}
