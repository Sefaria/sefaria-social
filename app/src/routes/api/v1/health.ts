import { createFileRoute } from "@tanstack/react-router";
import { getHealth } from "~/server/api/contracts";
import { bind, serve } from "~/server/http/endpoint";
import { checkHealth } from "~/server/services/health";
import { ensureAssetWorker } from "~/server/jobs/process-asset";

// GET /api/v1/health: public (PUBLIC_ENDPOINTS); checks the database only. The platform calls it from the moment the server
// starts, so it also starts the asset processing worker (spec 052 AC-006), which picks up work left by a restart.
export const Route = createFileRoute("/api/v1/health")({
  server: {
    handlers: serve({
      GET: bind(getHealth, () => {
        ensureAssetWorker();
        return checkHealth();
      }),
    }),
  },
});
