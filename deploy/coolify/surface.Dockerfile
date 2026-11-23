# The surface bundle for a Coolify deployment (docker-compose.yaml, spec 022): the release build of the surface, served
# as static files by an unprivileged nginx. One bundle per deployment, at the root: /manifest.json and the files it lists.
FROM node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS build
WORKDIR /src
ENV CI=true NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY harness/package.json harness/
COPY packages/api-client/package.json packages/api-client/
COPY packages/host-contract/package.json packages/host-contract/
COPY packages/relay/package.json packages/relay/
COPY packages/session/package.json packages/session/
RUN npm ci --ignore-scripts
COPY . .
# The manifest's version: Coolify passes SOURCE_COMMIT when "include source commit in build" is on; a local build says "local".
ARG SOURCE_COMMIT=local
RUN SURFACE_VERSION="coolify-${SOURCE_COMMIT}" npm run build:surface

FROM nginxinc/nginx-unprivileged:1.29.3-alpine@sha256:5aea7cc516b419e3526f47dd1531be31a56a046cfe44754d94f9383e13e2ee99
COPY --from=build /src/app/dist-surface /usr/share/nginx/html
COPY deploy/coolify/surface-nginx.conf /etc/nginx/conf.d/default.conf
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/manifest.json"]
