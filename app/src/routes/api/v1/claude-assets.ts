import { createFileRoute } from "@tanstack/react-router";
import { listMyClaudeAssets, saveClaudeAsset } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as claudeAssets from "~/server/services/claude-assets";

// /api/v1/claude-assets: the caller's own Claude assets, and saving one (spec 060). Saving also takes an MCP token (spec 064).
export const Route = createFileRoute("/api/v1/claude-assets")({
  server: {
    handlers: serve({
      GET: bind(listMyClaudeAssets, async ({ identity }) => reply(200, await claudeAssets.listMine(identity))),
      POST: bind(saveClaudeAsset, async ({ identity, body }) => claudeAssets.saveAsset(identity, body)),
    }),
  },
});
