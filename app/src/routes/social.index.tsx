import { createFileRoute } from "@tanstack/react-router";
import { FeedRoutePage } from "~/features/feed/Feed";
import { validateNoSearch } from "~/features/shell/social-routes";

// `/social`: the feed (plan R6; spec 015).
export const Route = createFileRoute("/social/")({
  validateSearch: validateNoSearch,
  component: FeedRoutePage,
});
