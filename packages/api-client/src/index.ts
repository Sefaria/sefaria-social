// The typed client for the social API, generated from openapi.json (plan section 6.2). The surface reaches the server only
// through this package. The token comes from a callback (host.viewer.identityToken()) and is held by the caller in memory;
// this client never stores it.
import createClient, { type Client, type Middleware } from "openapi-fetch";
import type { paths } from "./schema";

export type { components, operations, paths } from "./schema";
/** A room as the API returns it. */
export type Room = paths["/api/v1/rooms/{roomId}"]["get"]["responses"][200]["content"]["application/json"];
/** The viewer's feed (spec 015). */
export type Feed = paths["/api/v1/feed"]["get"]["responses"][200]["content"]["application/json"];
/** A page of the timeline (spec 023). */
export type Timeline = paths["/api/v1/timeline"]["get"]["responses"][200]["content"]["application/json"];
/** A post as the timeline shows it (spec 023). */
export type Post = Timeline["posts"][number];
/** One post with its replies (specs 023, 024). */
export type PostWithReplies = paths["/api/v1/posts/{postId}"]["get"]["responses"][200]["content"]["application/json"];
/** A reply (spec 024). */
export type Reply = PostWithReplies["replies"][number];
/** A profile with its latest posts (spec 025). */
export type ProfileWithPosts = paths["/api/v1/profiles/{profileId}"]["get"]["responses"][200]["content"]["application/json"];
/** A person's or an institution's profile (spec 025). */
export type Profile = ProfileWithPosts["profile"];
/** The viewer's own profile (spec 025). */
export type MyProfile = paths["/api/v1/profiles/me"]["get"]["responses"][200]["content"]["application/json"];
/** The viewer's notifications (spec 026). */
export type NotificationList = paths["/api/v1/notifications"]["get"]["responses"][200]["content"]["application/json"];
/** One notification (spec 026). */
export type Notification = NotificationList["notifications"][number];

export interface ApiClientOptions {
  /** Origin of the social server, for example https://social.sefaria.org */
  baseUrl: string;
  /** Returns a current identity token, or null when signed out (the request then goes without one). */
  getToken: () => Promise<string | null>;
  /** Returns the correlation id to send (propagated from the surface into server logs). */
  correlationId?: () => string;
  fetch?: typeof fetch;
}

export type ApiClient = Client<paths>;

export function createApiClient(options: ApiClientOptions): ApiClient {
  const client = createClient<paths>({ baseUrl: options.baseUrl, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await options.getToken();
      if (token) request.headers.set("authorization", `Bearer ${token}`);
      if (options.correlationId) request.headers.set("x-correlation-id", options.correlationId());
      return request;
    },
  };
  client.use(auth);
  return client;
}
