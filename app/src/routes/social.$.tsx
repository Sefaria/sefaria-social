import { createFileRoute } from "@tanstack/react-router";
import { SocialNotFound } from "~/features/shell/SocialNotFound";
import { validateNoSearch } from "~/features/shell/social-routes";

// Anything else under /social renders social's own not-found page (plan R6), not the reader's 404.
export const Route = createFileRoute("/social/$")({
  validateSearch: validateNoSearch,
  component: SocialNotFound,
});
