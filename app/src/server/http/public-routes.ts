// The explicit public list (plan section 6.1): the only API endpoints that answer without credentials. Everything else
// requires a verified Sefaria identity (or, for Django's webhook, a valid signature). Adding a line here needs a reason in
// the PR and a human reviewer; `defineEndpoint` refuses `access: "public"` for anything not listed.
export const PUBLIC_ENDPOINTS: ReadonlySet<string> = new Set([
  // Load balancers and uptime checks; reports the database only.
  "GET /api/v1/health",
  // Posted live cards (spec 056): the live state of a room, broadcast or recording, only for ids that a post embeds. Decision
  // 0011 D9 makes a posted session an open invitation; a session nobody posted is left out, so ids cannot be probed.
  "GET /api/v1/live",
]);
