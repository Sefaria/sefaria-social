// The typed client for the social API, generated from openapi.json (plan section 6.2). The surface reaches the server only
// through this package. The token comes from a callback (host.viewer.identityToken()) and is held by the caller in memory;
// this client never stores it.
import createClient, { type Client, type Middleware } from "openapi-fetch";
import type { paths } from "./schema";

export type { components, operations, paths } from "./schema";
/** A room as the API returns it. */
export type Room = paths["/api/v1/rooms/{roomId}"]["get"]["responses"][200]["content"]["application/json"];

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
