import { createFileRoute } from "@tanstack/react-router";
import { getHealth } from "~/server/api/contracts";
import { bind, serve } from "~/server/http/endpoint";
import { checkHealth } from "~/server/services/health";

// GET /api/v1/health: public (PUBLIC_ENDPOINTS); checks the database only.
export const Route = createFileRoute("/api/v1/health")({
  server: { handlers: serve({ GET: bind(getHealth, () => checkHealth()) }) },
});
