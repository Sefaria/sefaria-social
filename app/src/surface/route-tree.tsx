// The surface's route tree: the second of the two thin trees (docs/decisions/0003-two-builds.md). The Start app's generated
// tree cannot be imported here, because it carries the Start runtime, the document shell and (from P2) the API routes with
// their server code. Same paths as the file routes in app/src/routes (app/src/route-trees.test.ts checks), same page
// components and the same search validation; the root renders content only, never a document.
import { Outlet, createRootRouteWithContext, createRoute, lazyRouteComponent } from "@tanstack/react-router";
import type { SurfaceHost } from "@sefaria-social/host-contract";
import { FeedPage } from "~/features/feed/FeedPage";
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
  component: FeedPage,
});

// The other pages are separate chunks: the reader downloads them only when the user opens them.
const RoomLobbyPage = lazyRouteComponent(() => import("~/features/room/RoomLobbyPage"), "RoomLobbyPage");
const ShiurPage = lazyRouteComponent(() => import("~/features/shiur/ShiurPage"), "ShiurPage");
const SettingsPage = lazyRouteComponent(() => import("~/features/settings/SettingsPage"), "SettingsPage");

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

export const surfaceRouteTree = rootRoute.addChildren([feedRoute, roomRoute, shiurRoute, settingsRoute, notFoundRoute]);
