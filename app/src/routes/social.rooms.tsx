import { createFileRoute } from "@tanstack/react-router";
import { RoomsPage } from "~/features/rooms/RoomsPage";
import { validateNoSearch } from "~/features/shell/social-routes";

// `/social/rooms`: the viewer's rooms (plan R6; spec 044). Same definitions as the surface tree.
export const Route = createFileRoute("/social/rooms")({
  validateSearch: validateNoSearch,
  component: RoomsPage,
});
