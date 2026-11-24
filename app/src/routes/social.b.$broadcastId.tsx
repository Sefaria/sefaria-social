import { createFileRoute } from "@tanstack/react-router";
import { WatchPage } from "~/features/broadcast/WatchPage";
import { requireId, validateNoSearch } from "~/features/shell/social-routes";

// `/social/b/$broadcastId`: a broadcast's page (spec 043). Same definitions as the surface tree (app/src/surface/route-tree.tsx).
export const Route = createFileRoute("/social/b/$broadcastId")({
  validateSearch: validateNoSearch,
  beforeLoad: ({ params }) => requireId(params.broadcastId),
  component: function BroadcastRoute() {
    return <WatchPage broadcastId={Route.useParams().broadcastId} />;
  },
});
