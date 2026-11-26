// The reviewed list of endpoints that accept a token issued through Sefaria's MCP connector (spec 064; plan 7.1): Django marks
// such a token with `via: "mcp"`, and it may do one thing, save a Claude asset. Every other route refuses it (403
// auth.mcp_not_allowed). Adding a line here needs a reason in the PR and a human reviewer; `defineEndpoint` refuses `mcp: true`
// for anything not listed.
export const MCP_ENDPOINTS: ReadonlySet<string> = new Set([
  // Save a Claude asset from the MCP's save_asset tool (dry run first, then the save).
  "POST /api/v1/claude-assets",
  // The same from a URL the user gives Claude.
  "POST /api/v1/claude-assets/import",
]);
