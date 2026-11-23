import { createFileRoute } from "@tanstack/react-router";
import { ShiurPage } from "~/features/shiur/ShiurPage";
import { requireId, validateNoSearch } from "~/features/shell/social-routes";

// `/social/s/$shiurId`: a shiur page (plan R6). Same definitions as the surface tree (app/src/surface/route-tree.tsx).
export const Route = createFileRoute("/social/s/$shiurId")({
  validateSearch: validateNoSearch,
  beforeLoad: ({ params }) => requireId(params.shiurId),
  component: function ShiurRoute() {
    return <ShiurPage shiurId={Route.useParams().shiurId} />;
  },
});
