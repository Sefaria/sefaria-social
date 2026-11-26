import { createFileRoute } from "@tanstack/react-router";
import { searchPeople } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as people from "~/server/services/people";

// /api/v1/people?q=: people by @handle or name, for the invite bar's suggestions (spec 058).
export const Route = createFileRoute("/api/v1/people")({
  server: {
    handlers: serve({
      GET: bind(searchPeople, async ({ identity, query }) =>
        reply(200, { people: await people.searchPeople(identity, query.q) }),
      ),
    }),
  },
});
