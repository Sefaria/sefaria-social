import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "~/features/settings/SettingsPage";
import { validateSettingsSearch } from "~/features/shell/social-routes";

// `/social/settings`: social settings (plan R6), tab in the search (R7). Same definitions as the surface tree.
export const Route = createFileRoute("/social/settings")({
  validateSearch: validateSettingsSearch,
  component: function SettingsRoute() {
    return <SettingsPage tab={Route.useSearch().tab} />;
  },
});
