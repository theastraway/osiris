#!/usr/bin/env bash
# Idempotent Osiris deploy for DO1-Achilles. Run ON the droplet, from the repo's deploy/ dir.
# Safe to re-run: pulls latest image, recreates only the osiris stack, never touches other services.
set -euo pipefail

cd "$(dirname "$0")"
COMPOSE="docker compose -p osiris -f docker-compose.osiris.yml"

echo "── Osiris deploy on $(hostname) @ $(date -u +%FT%TZ) ──"

# 0. Build insurance: ensure ≥2G swap so `next build` can't OOM-kill cc-bridge.
if [ "$(free -m | awk '/Swap:/{print $2}')" -lt 1024 ]; then
  echo "── adding 2G swapfile (build insurance) ──"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 1. Sanity: don't clobber anything bound to 80/443/3001 that isn't ours.
for port in 80 443; do
  if ss -ltn "( sport = :$port )" | grep -q LISTEN && ! docker ps --format '{{.Names}}' | grep -q osiris-caddy; then
    echo "WARN: port $port already in use by a non-Osiris process. Resolve before deploying." >&2
  fi
done

# 2. Ensure .env.osiris exists (empty is fine for the vanilla globe).
[ -f .env.osiris ] || { echo "creating empty .env.osiris (keyless globe works)"; cp .env.osiris.example .env.osiris; }

# 3. Build (osiris) + pull (caddy/postgres) + (re)create the stack.
$COMPOSE pull caddy postgres
$COMPOSE up -d --build --remove-orphans

# 4. Health check — wait up to 90s for the app to answer internally.
echo "── waiting for app health ──"
for i in $(seq 1 30); do
  if docker exec osiris-caddy wget -qO- http://osiris:3000/ >/dev/null 2>&1; then
    echo "✅ app responding internally"; break
  fi
  sleep 3
  [ "$i" = "30" ] && { echo "❌ app did not become healthy in 90s"; $COMPOSE logs --tail=40 osiris; exit 1; }
done

# 5. Report public reachability (TLS issuance can take ~30s on first run).
echo "── public check ──"
for host in osiris.m-i-n-d.ai ozzie.m-i-n-d.ai; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$host/" || echo "TLS-pending")
  echo "  https://$host  -> $code"
done

echo "── existing DO1 services untouched (osiris uses its own project + ports) ──"
$COMPOSE ps
