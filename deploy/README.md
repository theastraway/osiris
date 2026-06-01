# Osiris Deploy — DO1-Achilles

Target: **DO1-Achilles** `45.55.224.170` (verified lightest box: 2.7 GB free, 0.09 load, 90 GB disk, no containers). Distinct Docker project + ports so the existing **cc-bridge/OpenClaw** services are never touched.

## Stack
- `osiris-app` — Next.js globe (internal :3000, `mem_limit 1g`, `cpus 1.0`)
- `osiris-caddy` — TLS + reverse proxy for `osiris.m-i-n-d.ai` + `ozzie.m-i-n-d.ai` (binds host :80/:443)
- `osiris-postgres` — auth/billing/watchlists store (used from Phase 2)

## Prerequisites
1. **DNS** (Cloudflare zone `m-i-n-d.ai`): two A records → `45.55.224.170`
   - `osiris` — **DNS-only (grey cloud)** for Phase 1 so Caddy can do HTTP-01.
   - `ozzie` — same.
   (Hardening flips both to proxied + a Cloudflare Origin cert.)
2. **Firewall**: allow inbound 80 + 443 on the droplet. Leave existing service ports as-is.

## Deploy (run on the droplet)
```bash
# from a clone of theastraway/osiris on DO1
cd osiris/deploy
cp .env.osiris.example .env.osiris   # Phase 1: leave keys blank, keyless feeds work
bash deploy-do1.sh                   # idempotent; safe to re-run
```

## Verify
- `https://osiris.m-i-n-d.ai` and `https://ozzie.m-i-n-d.ai` load the globe (CDP desktop + 390px mobile).
- `docker compose -p osiris ps` all healthy.
- Existing DO1 services unaffected: `systemctl status cc-bridge` (or the OpenClaw gateway) still active.

## Rollback
```bash
docker compose -p osiris -f docker-compose.osiris.yml down        # stop Osiris only
# remove DNS records osiris/ozzie in Cloudflare to fully revert public exposure
```
Nothing else on the box is modified; `down` leaves cc-bridge/OpenClaw running.

## Phase 2+ (our own image)
Swap `image: ghcr.io/aiacos/osiris:latest` for `build:` against the fork's `../Dockerfile` once auth/Stripe/Ozzie UI land, then re-run `deploy-do1.sh`.
