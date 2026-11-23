// `npm run smoke:server` (after `npm run build`): the built Start server's own fetch handler serves the API, which proves
// the route files are wired into the production build, not only into the test harness. Needs DATABASE_URL (migrated).
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../dist/server/server.js", import.meta.url));
const server = (await import(pathToFileURL(entry).href)).default;

const checks = [
  ["GET", "/api/v1/health", 200],
  ["GET", "/api/v1/rooms", 401],
  ["DELETE", "/api/v1/rooms/00000000-0000-4000-8000-000000000000", 401],
  ["POST", "/api/v1/internal/user-deleted", 401],
  ["GET", "/api/v1/me", 401],
  // The test-only persona route (spec 082) is never in the production build: an unknown path, never a session.
  ["POST", "/api/test/persona", 404],
];
let failed = 0;
for (const [method, path, expected] of checks) {
  const res = await server.fetch(
    new Request(`http://localhost:3200${path}`, { method, body: method === "POST" ? "{}" : undefined }),
  );
  const ok = res.status === expected;
  if (!ok) failed++;
  console.log(`${ok ? "ok" : "x "} ${method} ${path} -> ${res.status} (expected ${expected})`);
}
process.exit(failed ? 1 : 0);
