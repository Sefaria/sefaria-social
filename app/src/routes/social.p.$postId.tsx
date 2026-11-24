import { createFileRoute } from "@tanstack/react-router";
import { PostPage } from "~/features/post/PostPage";
import { requireId, validateNoSearch } from "~/features/shell/social-routes";

// `/social/p/$postId`: one post on its own page (plan R6; spec 023). Same definitions as the surface tree.
export const Route = createFileRoute("/social/p/$postId")({
  validateSearch: validateNoSearch,
  beforeLoad: ({ params }) => requireId(params.postId),
  component: function PostRoute() {
    return <PostPage postId={Route.useParams().postId} />;
  },
});
