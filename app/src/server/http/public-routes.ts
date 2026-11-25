// The explicit public list (plan section 6.1): the only API endpoints that answer without credentials. Everything else
// requires a verified Sefaria identity (or, for Django's webhook, a valid signature). Adding a line here needs a reason in
// the PR and a human reviewer; `defineEndpoint` refuses `access: "public"` for anything not listed.
export const PUBLIC_ENDPOINTS: ReadonlySet<string> = new Set([
  // Load balancers and uptime checks; reports the database only.
  "GET /api/v1/health",
  // A ready shiur recording opens for anyone who has its link (owner's decision D2, docs/plans/shiur.md; spec 051). The id is
  // an unguessable UUID; the answer carries no room, no user id, nothing only a member sees; recordings in progress are 404.
  "GET /api/v1/assets/{assetId}",
  "GET /api/v1/assets/{assetId}/state",
  "GET /api/v1/assets/{assetId}/media",
]);
