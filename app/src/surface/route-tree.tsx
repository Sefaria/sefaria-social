// The surface's route tree: the second of the two thin trees (docs/decisions/0003-two-builds.md). The Start app's generated
// tree cannot be imported here, because it carries the Start runtime, the document shell and (from P2) the API routes with
// their server code. Same paths as the file routes in app/src/routes (app/src/route-trees.test.ts checks), same page
// components and the same search validation; the root renders content only, never a document.
import { Outlet, createRootRouteWithContext, createRoute, lazyRouteComponent } from "@tanstack/react-router";
import type { SurfaceHost } from "@sefaria-social/host-contract";
import { FeedRoutePage } from "~/features/feed/Feed";
import { SocialLayout } from "~/features/shell/SocialLayout";
import { SocialNotFound } from "~/features/shell/SocialNotFound";
import { SOCIAL_PATHS, requireId, validateNoSearch, validateSettingsSearch } from "~/features/shell/social-routes";

export interface SurfaceRouterContext {
  mode: "surface";
  host: SurfaceHost;
}

const rootRoute = createRootRouteWithContext<SurfaceRouterContext>()({
  component: () => (
    <SocialLayout>
      <Outlet />
    </SocialLayout>
  ),
  notFoundComponent: SocialNotFound,
});

const feedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SOCIAL_PATHS.feed,
  validateSearch: validateNoSearch,
  component: FeedRoutePage,
});

// The other pages are separate chunks: the reader downloads them only when the user opens them.
const RoomLobbyPage = lazyRouteComponent(() => import("~/features/room/RoomLobbyPage"), "RoomLobbyPage");
const ShiurPage = lazyRouteComponent(() => import("~/features/shiur/ShiurPage"), "ShiurPage");
const SettingsPage = lazyRouteComponent(() => import("~/features/settings/SettingsPage"), "SettingsPage");
const PostPage = lazyRouteComponent(() => import("~/features/post/PostPage"), "PostPage");
const ProfilePage = lazyRouteComponent(() => import("~/features/profile/ProfilePage"), "ProfilePage");
const RecordingPage = lazyRouteComponent(() => import("~/features/replay/RecordingPage"), "RecordingPage");
const WatchPage = lazyRouteComponent(() => import("~/features/broadcast/WatchPage"), "WatchPage");
const ActivityPage = lazyRouteComponent(() => import("~/features/notifications/ActivityPage"), "ActivityPage");

const roomRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SOCIAL_PATHS.room,
  validateSearch: validateNoSearch,
  beforeLoad: ({ params }) => requireId(params.roomId),
  component: function RoomRoute() {
    return <RoomLobbyPage roomId={roomRoute.useParams().roomId} />;
  },
});

const shiurRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SOCIAL_PATHS.shiur,
  validateSearch: validateNoSearch,
  beforeLoad: ({ params }) => requireId(params.shiurId),
  component: function ShiurRoute() {
    return <ShiurPage shiurId={shiurRoute.useParams().shiurId} />;
  },
});

const postRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SOCIAL_PATHS.post,
  validateSearch: validateNoSearch,
  beforeLoad: ({ params }) => requireId(params.postId),
  component: function PostRoute() {
    return <PostPage postId={postRoute.useParams().postId} />;
  },
});

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SOCIAL_PATHS.profile,
  validateSearch: validateNoSearch,
  beforeLoad: ({ params }) => requireId(params.profileId),
  component: function ProfileRoute() {
    return <ProfilePage profileId={profileRoute.useParams().profileId} />;
  },
});

const recordingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SOCIAL_PATHS.recording,
  validateSearch: validateNoSearch,
  beforeLoad: ({ params }) => requireId(params.recordingId),
  component: function RecordingRoute() {
    return <RecordingPage recordingId={recordingRoute.useParams().recordingId} />;
  },
});

// A broadcast's page (spec 043). The path is written here and in its file route (social-routes.ts is outside this task).
const broadcastRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/social/b/$broadcastId",
  validateSearch: validateNoSearch,
  beforeLoad: ({ params }) => requireId(params.broadcastId),
  component: function BroadcastRoute() {
    return <WatchPage broadcastId={broadcastRoute.useParams().broadcastId} />;
  },
});

const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SOCIAL_PATHS.notifications,
  validateSearch: validateNoSearch,
  component: ActivityPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SOCIAL_PATHS.settings,
  validateSearch: validateSettingsSearch,
  component: function SettingsRoute() {
    return <SettingsPage tab={settingsRoute.useSearch().tab} />;
  },
});

const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SOCIAL_PATHS.notFound,
  validateSearch: validateNoSearch,
  component: SocialNotFound,
});

export const surfaceRouteTree = rootRoute.addChildren([
  feedRoute,
  roomRoute,
  shiurRoute,
  postRoute,
  profileRoute,
  recordingRoute,
  broadcastRoute,
  notificationsRoute,
  settingsRoute,
  notFoundRoute,
]);
