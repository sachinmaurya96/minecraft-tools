# Development and deployment

Use Node 24 LTS **24.15+**, npm 11, and Python 3.12. `.nvmrc` selects Node 24;
run `nvm install && nvm use` if nvm is installed. The pre-existing development
machine has 24.13; its checks pass, but jsdom's engine requirement is 24.15+.

## Run locally

```sh
npm ci
npm run setup
npm run build:packages
```

For web and API without Python:

```sh
npm run dev:manual
```

For the CPU geometry worker as well, install uv and create its locked environment:

```sh
cd services/ai-worker
uv sync --frozen
cd ../..
npm run dev
```

Open <http://localhost:5173>. API: <http://127.0.0.1:4000/health>.
Worker: <http://127.0.0.1:8000/health>. `npm run setup` creates matching random
worker tokens in `apps/api/.env` and `services/ai-worker/.env`, preserves existing
settings, and keeps AI disabled. Never put credentials in `VITE_*` variables.
On this Mac uv is installed at `~/Library/Python/3.9/bin/uv`; add that directory
to PATH if `uv` is not found.

## Single-origin production server

```sh
npm ci
npm run build
SERVE_WEB_DIST=../web/dist NODE_ENV=production npm start
```

Open <http://localhost:4000> (set `WEB_ORIGIN=http://localhost:4000` in the API env).
The API serves hashed assets with immutable caching and all other web routes
with SPA fallback. `/api` failures remain JSON; a direct editor route refresh
works. Bind `API_HOST=0.0.0.0` only when needed and terminate HTTPS at a proxy.
Set `TRUST_PROXY` to the actual proxy topology; do not trust arbitrary forwarded IPs.

Persist `DATA_DIR`, including its generated session signing key. One API process
owns one data directory. The filesystem queue/storage is **not designed for
multiple API replicas**; use a shared transactional store/queue before scaling.
Worker model environments are separate from the lightweight Python environment.

## Containers

```sh
cp .env.example .env
# Replace AI_WORKER_TOKEN with a random value and set WEB_ORIGIN=http://localhost:4000
docker compose up --build -d --wait
```

The API publishes port 4000 to loopback. The worker is reachable only on the
Compose network. Both services run as unprivileged users with persistent named
volumes. AI is disabled in this CPU configuration. Add a TLS reverse proxy for
public hosting, set the exact public origin, and limit body sizes/requests there.
Use `docker compose logs` to diagnose startup. `docker compose down` preserves
volumes; `down -v` deletes projects and keys.

Docker is not installed on the development machine: the Dockerfiles and Compose
smoke stage are supplied but **local container execution is unverified**. CI
defines a separate container build/health check. No hosted deployment was made.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run test:python
npm run build
npm run verify:exports
npm run test:integration
npx playwright install chromium
npm run test:e2e
```

The browser suite builds first and uses an isolated temporary production server.
The integration smoke uses real Python conversion and Node API, without model
fakes, and writes `fixtures/generated/converted.mcaddon`. Independent ZIP/PNG
checks use Python stdlib and Pillow. CI uses the lockfiles and retains reports
and sample exports. GPU inference and in-game checks are separate manual gates.

## Capacity

Defaults: 10 MB/image, 20 million image pixels, four reference roles, 25 MB/mesh,
512 cuboids, one running API job, ten queued jobs, two active jobs/session,
900-second API timeout. The worker's Sking/TripoSR subprocess timeouts are
600/1800 seconds; raise the API timeout deliberately if enabling slower inference.
Rate limits and TTLs are configurable in `.env.example`. Filesystem storage and
per-process rate limiting suit a small deployment; public service needs disk
monitoring, host quotas, backups/retention policy, and load measurement.

No GPU timing/cost benchmark exists for this machine. Model weights being
downloadable does not supply hosting capacity. Keep both AI flags false until
actual inference, result validation, licensing, and game tests are recorded.
