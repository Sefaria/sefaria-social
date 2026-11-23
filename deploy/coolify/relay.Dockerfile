# The relay for a Coolify deployment (docker-compose.yaml, spec 022): the Worker in workerd through `wrangler dev`, the
# same local runtime the integration tests and `qa:relay` use. Good for previews and the shared dev deployment; production runs
# on Cloudflare (docs/runbooks/deploy.md). Room state lives in memory and in /tmp; a restart empties every room.
FROM node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
WORKDIR /srv
# workerd verifies TLS (for the JWKS fetch) against the system's CA store, which the slim image does not ship.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ENV CI=true NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false WRANGLER_SEND_METRICS=false
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY harness/package.json harness/
COPY packages/api-client/package.json packages/api-client/
COPY packages/host-contract/package.json packages/host-contract/
COPY packages/relay/package.json packages/relay/
COPY packages/session/package.json packages/session/
RUN npm ci --workspace @sefaria-social/relay --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages/relay packages/relay
COPY packages/session packages/session
COPY deploy/coolify/relay-start.sh /srv/relay-start.sh
RUN chown -R node:node /srv/packages/relay
USER node
ENV HOME=/tmp
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["sh", "/srv/relay-start.sh"]
