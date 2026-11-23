// The explicit public list (plan section 6.1): the only API endpoints that answer without credentials. Everything else
// requires a verified Sefaria identity (or, for Django's webhook, a valid signature). Adding a line here needs a reason in
// the PR and a human reviewer; `defineEndpoint` refuses `access: "public"` for anything not listed.
export const PUBLIC_ENDPOINTS: ReadonlySet<string> = new Set([
  // Load balancers and uptime checks; reports the database only.
  "GET /api/v1/health",
]);
