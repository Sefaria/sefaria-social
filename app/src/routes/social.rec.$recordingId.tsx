import { createFileRoute } from "@tanstack/react-router";
import { RecordingPage } from "~/features/replay/RecordingPage";
import { requireId, validateNoSearch } from "~/features/shell/social-routes";

// `/social/rec/$recordingId`: a recording's page (spec 042). Same definitions as the surface tree (app/src/surface/route-tree.tsx).
export const Route = createFileRoute("/social/rec/$recordingId")({
  validateSearch: validateNoSearch,
  beforeLoad: ({ params }) => requireId(params.recordingId),
  component: function RecordingRoute() {
    return <RecordingPage recordingId={Route.useParams().recordingId} />;
  },
});
