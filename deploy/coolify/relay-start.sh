#!/bin/sh
# Starts the relay (relay.Dockerfile). wrangler dev reads the Worker's settings from packages/relay/.dev.vars, so they are
# written there from the container's environment; nothing is baked into the image.
set -eu
: "${ALLOWED_ORIGINS:?ALLOWED_ORIGINS is required}"
: "${JWKS_URL:?JWKS_URL is required}"
: "${TOKEN_ISSUER:?TOKEN_ISSUER is required}"
: "${RELAY_INTERNAL_SECRET:?RELAY_INTERNAL_SECRET is required}"
cd /srv/packages/relay
umask 077
{
  printf 'ALLOWED_ORIGINS=%s\n' "$ALLOWED_ORIGINS"
  printf 'JWKS_URL=%s\n' "$JWKS_URL"
  printf 'TOKEN_ISSUER=%s\n' "$TOKEN_ISSUER"
  printf 'RELAY_INTERNAL_SECRET=%s\n' "$RELAY_INTERNAL_SECRET"
} > .dev.vars
exec npx wrangler dev --ip 0.0.0.0 --port 8787 --persist-to /tmp/relay-state
