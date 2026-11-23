#!/usr/bin/env bash
# The server image, run for real (spec 021 AC-002; CI's container job). Needs Docker and a Postgres reachable from the host
# network at DATABASE_URL. Migrates with the image's own command, starts the server, waits for Docker to report it healthy,
# checks health and a protected route, checks it does not run as root, and checks SIGTERM stops it within 10 seconds.
#
#   DATABASE_URL=postgres://… app/scripts/container-smoke.sh <image>
set -euo pipefail
image="${1:?usage: container-smoke.sh <image>}"
: "${DATABASE_URL:?DATABASE_URL must point at a Postgres the container can reach (host network)}"
port="${SMOKE_PORT:-3200}"
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok $1 ($2)"; else echo "x $1: got '$2', expected '$3'"; fail=1; fi; }

docker run --rm --network host -e DATABASE_URL "$image" node app/scripts/migrate.mjs
cid=$(docker run -d --network host -e DATABASE_URL -e PORT="$port" -e LOG_LEVEL=warn "$image")
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT

status=starting
for _ in $(seq 1 60); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$cid")
  [ "$status" = healthy ] || [ "$status" = unhealthy ] && break
  [ "$(docker inspect -f '{{.State.Running}}' "$cid")" = true ] || break
  sleep 2
done
check "docker health status" "$status" healthy
check "GET /api/v1/health" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/v1/health")" 200
check "GET /api/v1/rooms without a token" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/v1/rooms")" 401
uid=$(docker exec "$cid" id -u)
if [ "$uid" != 0 ]; then echo "ok runs as uid $uid"; else echo "x runs as root"; fail=1; fi

start=$(date +%s)
docker stop -t 10 "$cid" >/dev/null
took=$(( $(date +%s) - start ))
code=$(docker inspect -f '{{.State.ExitCode}}' "$cid")
check "exit code after SIGTERM" "$code" 0
if [ "$took" -lt 10 ]; then echo "ok stopped in ${took}s"; else echo "x took ${took}s to stop (SIGTERM ignored?)"; fail=1; fi
[ "$fail" = 0 ] || { docker logs "$cid" 2>&1 | tail -40; exit 1; }
echo "container smoke: PASS"
