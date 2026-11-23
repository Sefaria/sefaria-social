import { createFileRoute } from "@tanstack/react-router";
import { FeedPage } from "~/features/feed/FeedPage";
import { validateNoSearch } from "~/features/shell/social-routes";

// `/social`: the feed (plan R6). A placeholder until the feed spec is built.
export const Route = createFileRoute("/social/")({
  validateSearch: validateNoSearch,
  component: FeedPage,
});
