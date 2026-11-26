import { createFileRoute } from "@tanstack/react-router";
import { importClaudeAsset } from "~/server/api/contracts";
import { bind, serve } from "~/server/http/endpoint";
import * as claudeAssets from "~/server/services/claude-assets";

// /api/v1/claude-assets/import: fetch a public https URL once and save it (spec 060 AC-007). Takes an MCP token (spec 064).
export const Route = createFileRoute("/api/v1/claude-assets/import")({
  server: {
    handlers: serve({
      POST: bind(importClaudeAsset, async ({ identity, body }) => claudeAssets.importAsset(identity, body)),
    }),
  },
});
