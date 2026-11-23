import { createFileRoute } from "@tanstack/react-router";
import { RoomLobbyPage } from "~/features/room/RoomLobbyPage";
import { requireId, validateNoSearch } from "~/features/shell/social-routes";

// `/social/r/$roomId`: the room lobby (plan R6). Same definitions as the surface tree (app/src/surface/route-tree.tsx).
export const Route = createFileRoute("/social/r/$roomId")({
  validateSearch: validateNoSearch,
  beforeLoad: ({ params }) => requireId(params.roomId),
  component: function RoomRoute() {
    return <RoomLobbyPage roomId={Route.useParams().roomId} />;
  },
});
