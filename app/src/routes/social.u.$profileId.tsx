import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "~/features/profile/ProfilePage";
import { requireId, validateNoSearch } from "~/features/shell/social-routes";

// `/social/u/$profileId`: a person's or an institution's profile (plan R6; spec 025). Same definitions as the surface tree.
export const Route = createFileRoute("/social/u/$profileId")({
  validateSearch: validateNoSearch,
  beforeLoad: ({ params }) => requireId(params.profileId),
  component: function ProfileRoute() {
    return <ProfilePage profileId={Route.useParams().profileId} />;
  },
});
