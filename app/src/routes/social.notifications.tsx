import { createFileRoute } from "@tanstack/react-router";
import { ActivityPage } from "~/features/notifications/ActivityPage";
import { validateNoSearch } from "~/features/shell/social-routes";

// `/social/notifications`: the activity page (plan R6; spec 026). Same definitions as the surface tree.
export const Route = createFileRoute("/social/notifications")({
  validateSearch: validateNoSearch,
  component: ActivityPage,
});
