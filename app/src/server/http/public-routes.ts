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
  // Its manifest once processed (spec 052): files, length, chapters; nothing more than the three above already give.
  "GET /api/v1/assets/{assetId}/manifest",
  // Its transcript and its audio (spec 054): the same shiur in other forms; Sofer.ai fetches the audio from here.
  "GET /api/v1/assets/{assetId}/transcript",
  "GET /api/v1/assets/{assetId}/audio",
  // Posted live cards (spec 056): the live state of a room, broadcast or recording, only for ids that a post embeds. Decision
  // 0011 D9 makes a posted session an open invitation; a session nobody posted is left out, so ids cannot be probed.
  "GET /api/v1/live",
  // Claude assets (specs 060-063; Sefaria-Project LINKED_PANELS_AND_ASSETS_PLAN.md 6.3). An asset opens for anyone with its
  // unguessable id unless staff hid it; the answer names its author's public profile, never a Sefaria user id.
  "GET /api/v1/claude-assets/{assetId}",
  // Its files, sandboxed by their Content-Security-Policy and served only on ASSET_CONTENT_ORIGIN (spec 061). The shiur URL
  // carries a signed, expiring grant; without it the open-network policy is never served.
  "GET /api/v1/claude-assets/content/{versionId}",
  "GET /api/v1/claude-assets/content/{versionId}/shiur/{grant}",
  // The reader's sidebar asks which published assets cover a section or segment (spec 062): public, cacheable, no user data.
  "GET /api/v1/claude-assets/ref/{ref}",
  // A person's published assets on their profile (spec 063): what the sidebar shows anyway, by author.
  "GET /api/v1/profiles/{profileId}/claude-assets",
  // An unlisted or public shiur for anyone with its link (spec 063), as a ready recording is (decision 0011 D2); private: 404.
  "GET /api/v1/shiurim/{shiurId}",
]);
