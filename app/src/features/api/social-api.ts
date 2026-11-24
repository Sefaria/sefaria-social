// What the social pages need from the API (specs 023–026), behind one interface like rooms-api.ts and feed-api.ts: the
// surface builds it from the host (host.config.apiOrigin, host.viewer.identityToken()); component tests give a fake.
import { createContext, useContext } from "react";
import type { SurfaceHost } from "@sefaria-social/host-contract";
import {
  createApiClient,
  type MyProfile,
  type NotificationList,
  type Post,
  type PostWithReplies,
  type Profile,
  type ProfileWithPosts,
  type Reply,
  type Timeline,
} from "@sefaria-social/api-client";
import { useHost } from "~/features/host/host-context";

export type {
  MyProfile,
  Notification,
  NotificationList,
  Post,
  PostWithReplies,
  Profile,
  ProfileWithPosts,
  Reply,
  Timeline,
} from "@sefaria-social/api-client";

export type TimelineTab = "following" | "everyone";

/** An API error the interface can name: the server's stable code and the HTTP status. */
export class SocialApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`social API answered ${status} ${code}`);
    this.name = "SocialApiError";
  }
}

export interface SocialApi {
  timeline(tab: TimelineTab, before?: string): Promise<Timeline>;
  createPost(input: { body: string; ref?: string; asProfileId?: string; quotedPostId?: string }): Promise<Post>;
  getPost(postId: string): Promise<PostWithReplies>;
  deletePost(postId: string): Promise<void>;
  reply(postId: string, body: string): Promise<Reply>;
  deleteReply(replyId: string): Promise<void>;
  react(postId: string, on: boolean): Promise<{ reacted: boolean; reactionCount: number }>;
  repost(postId: string, on: boolean): Promise<{ reposted: boolean; repostCount: number }>;
  me(): Promise<MyProfile>;
  updateMe(input: { name?: string; bio?: string }): Promise<MyProfile>;
  profile(profileId: string): Promise<ProfileWithPosts>;
  suggested(): Promise<Profile[]>;
  follow(profileId: string, on: boolean): Promise<{ following: boolean; followers: number }>;
  notifications(): Promise<NotificationList>;
  readNotifications(): Promise<void>;
}

type Answer<T> = { data?: T; error?: unknown; response: Response };

function unwrap<T>(r: Answer<T>): T {
  if (r.data !== undefined && r.response.ok) return r.data;
  const code = (r.error as { error?: { code?: string } } | undefined)?.error?.code ?? "unknown";
  throw new SocialApiError(r.response.status, code);
}

function ok(r: { error?: unknown; response: Response }): void {
  if (r.response.ok) return;
  const code = (r.error as { error?: { code?: string } } | undefined)?.error?.code ?? "unknown";
  throw new SocialApiError(r.response.status, code);
}

export function createSocialApi(host: SurfaceHost): SocialApi {
  const c = createApiClient({
    baseUrl: host.config.apiOrigin,
    getToken: async () => (host.viewer.get() ? host.viewer.identityToken().catch(() => null) : null),
    correlationId: () => crypto.randomUUID(),
  });
  return {
    async timeline(tab, before) {
      return unwrap(await c.GET("/api/v1/timeline", { params: { query: { tab, ...(before ? { before } : {}) } } }));
    },
    async createPost(input) {
      return unwrap(await c.POST("/api/v1/posts", { body: input }));
    },
    async getPost(postId) {
      return unwrap(await c.GET("/api/v1/posts/{postId}", { params: { path: { postId } } }));
    },
    async deletePost(postId) {
      ok(await c.DELETE("/api/v1/posts/{postId}", { params: { path: { postId } } }));
    },
    async reply(postId, body) {
      return unwrap(await c.POST("/api/v1/posts/{postId}/replies", { params: { path: { postId } }, body: { body } }));
    },
    async deleteReply(replyId) {
      ok(await c.DELETE("/api/v1/replies/{replyId}", { params: { path: { replyId } } }));
    },
    async react(postId, on) {
      const init = { params: { path: { postId } } };
      return unwrap(
        on ? await c.PUT("/api/v1/posts/{postId}/reaction", init) : await c.DELETE("/api/v1/posts/{postId}/reaction", init),
      );
    },
    async repost(postId, on) {
      const init = { params: { path: { postId } } };
      return unwrap(
        on ? await c.PUT("/api/v1/posts/{postId}/repost", init) : await c.DELETE("/api/v1/posts/{postId}/repost", init),
      );
    },
    async me() {
      return unwrap(await c.GET("/api/v1/profiles/me"));
    },
    async updateMe(input) {
      return unwrap(await c.PATCH("/api/v1/profiles/me", { body: input }));
    },
    async profile(profileId) {
      return unwrap(await c.GET("/api/v1/profiles/{profileId}", { params: { path: { profileId } } }));
    },
    async suggested() {
      return unwrap(await c.GET("/api/v1/profiles", { params: { query: { suggested: "1" } } })).profiles;
    },
    async follow(profileId, on) {
      const init = { params: { path: { profileId } } };
      return unwrap(
        on
          ? await c.PUT("/api/v1/profiles/{profileId}/follow", init)
          : await c.DELETE("/api/v1/profiles/{profileId}/follow", init),
      );
    },
    async notifications() {
      return unwrap(await c.GET("/api/v1/notifications"));
    },
    async readNotifications() {
      ok(await c.POST("/api/v1/notifications/read"));
    },
  };
}

/** Lets tests provide the API; the surface leaves it empty and gets one built from the host. */
export const SocialApiContext = createContext<SocialApi | null>(null);

const built = new WeakMap<SurfaceHost, SocialApi>();

/** The social API for this host, or null in standalone mode with nothing provided. */
export function useSocialApi(): SocialApi | null {
  const provided = useContext(SocialApiContext);
  const host = useHost();
  if (provided) return provided;
  if (!host) return null;
  let api = built.get(host);
  if (!api) {
    api = createSocialApi(host);
    built.set(host, api);
  }
  return api;
}
