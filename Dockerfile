# The social server's image (spec 021; docs/runbooks/deploy.md). Two stages on the same pinned Node image: build the Start
# app from the lockfile, then copy the build and the production dependencies into a runtime stage that runs as `node`.
# Rules (checked by `npm run release -- check-dockerfile`, in CI's container job): every FROM pinned by exact tag and digest,
# nothing fetched from a URL, a non-root USER, a HEALTHCHECK on /api/v1/health. To move Node: pick the new exact tag, take
# its index digest from the registry, and change both FROM lines together.
FROM node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS build
WORKDIR /src
ENV CI=true NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
# Dependencies first (cached until the lockfile changes). Install scripts are off: no package runs code at install time.
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY harness/package.json harness/
COPY packages/api-client/package.json packages/api-client/
COPY packages/host-contract/package.json packages/host-contract/
COPY packages/relay/package.json packages/relay/
COPY packages/session/package.json packages/session/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS runtime
ENV NODE_ENV=production PORT=3200 HOST=0.0.0.0
WORKDIR /srv
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/packages ./packages
COPY --from=build /src/app/package.json ./app/
COPY --from=build /src/app/dist ./app/dist
COPY --from=build /src/app/scripts/start.mjs /src/app/scripts/migrate.mjs ./app/scripts/
COPY --from=build /src/app/src/server/db/migrations ./app/src/server/db/migrations
USER node
EXPOSE 3200
# Node's own fetch (the slim image has no curl). 200 when the database answers within 2 s, else 503 (spec 005).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3200)+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
STOPSIGNAL SIGTERM
CMD ["node", "app/scripts/start.mjs"]
