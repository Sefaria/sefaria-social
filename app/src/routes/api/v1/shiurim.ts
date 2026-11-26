import { createFileRoute } from "@tanstack/react-router";
import { createShiur, listMyShiurim } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as shiurim from "~/server/services/shiurim";

// /api/v1/shiurim: the caller's shiurim, and creating one (spec 063).
export const Route = createFileRoute("/api/v1/shiurim")({
  server: {
    handlers: serve({
      GET: bind(listMyShiurim, async ({ identity }) => reply(200, await shiurim.listMyShiurim(identity))),
      POST: bind(createShiur, async ({ identity, body }) => reply(201, await shiurim.createShiur(identity, body))),
    }),
  },
});
