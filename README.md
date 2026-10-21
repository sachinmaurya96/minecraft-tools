# Blockwright — tools for Minecraft creators

> **NOT AN OFFICIAL MINECRAFT SERVICE. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.**

Blockwright is a small, extensible website for Minecraft-related creation tools.
The first tool is the **Character Builder**, which turns reference photos (or a
template, or an existing skin) into either:

| Output               | What it is                                                                                                                           | Works in                                                                                                          | What it is _not_                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Player skin**      | 64×64 RGBA PNG in the standard skin atlas, classic (4 px) or slim (3 px) arms                                                        | Minecraft **Java Edition** skin selector/launcher (manual import). Bedrock skin import varies by device/platform. | It cannot change the player's body shape — no wings, horns with volume or extra parts.               |
| **Custom 3D entity** | `.mcaddon` with a behavior pack + resource pack: geometry (`.geo.json`), texture, client/server entity, render controller, spawn egg | Minecraft **Bedrock Edition** worlds (activate both packs, then `/summon namespace:name`)                         | Not a Java mod, not a player skin, and a raw `.glb`/`.obj` is never passed off as a Minecraft model. |

Every result is labelled **Manual**, **Photo-assisted**, **AI-generated** or **Demo sample**.
The manual and photo-assisted paths are deterministic and need **no GPU and no paid AI**.
AI generation (Sking for skins, TripoSR for meshes) is optional, requires specific
hardware, and is only offered when the server has verified that it actually runs.

See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for what is
built and tested, and [`docs/FINAL_REPORT.md`](docs/FINAL_REPORT.md) for the
verification report.

## Toolchain

| Tool    | Version used          | Notes                                                                       |
| ------- | --------------------- | --------------------------------------------------------------------------- |
| Node.js | 24 LTS, 24.15+        | `.nvmrc`; existing machine also passed checks on 24.13.0                    |
| npm     | 11                    | npm workspaces                                                              |
| Python  | 3.12 (tested 3.12.15) | for the AI/geometry worker; installed with [uv](https://docs.astral.sh/uv/) |
| uv      | 0.13+                 | creates the worker virtualenv from `services/ai-worker/pyproject.toml`      |

Optional, only for AI features: Linux + NVIDIA CUDA GPU for Sking; TripoSR runs on
CUDA or (slowly) CPU. See [`docs/MODELS_AND_LICENSES.md`](docs/MODELS_AND_LICENSES.md).

## Quick start (no GPU needed)

```bash
npm ci                                   # install JS dependencies
npm run setup                            # matching local API/worker settings; preserves existing files
npm run build:packages                   # build shared workspace packages
npm run dev:manual                       # web :5173 + API :4000; skin/entity/photo tools
```

Open <http://localhost:5173>. For mesh conversion, run `uv sync --frozen` in
`services/ai-worker`, then `npm run dev` to start all three services. Details:
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Repository layout

```text
apps/web            Vite + React + TypeScript website (tool registry, Character Builder)
apps/api            Express + TypeScript REST API (/api/v1)
services/ai-worker  Python FastAPI worker: optional AI adapters + mesh → cuboid conversion
packages/shared     API schemas, error codes, raster/PNG helpers
packages/minecraft-skin   skin atlas, validation, editor utilities, photo projection
packages/bedrock-export   cuboid model → atlas → .geo.json → packs, plus validators
scripts/            export verification, fixtures, dev helpers
docs/               architecture, API, deployment, privacy, user guide, test reports
```

## Common commands

```bash
npm run typecheck      # TypeScript across all workspaces
npm run lint           # ESLint
npm test               # unit + API tests (Vitest)
npm run test:python    # worker tests (pytest)
npm run test:integration # real CPU worker + API -> .mcaddon smoke
npm run test:e2e       # Playwright browser tests
npm run verify:exports # independent validation of exported PNG/.mcaddon files
npm run build          # production build of packages, API and web
```

Current automated verification: 116 JavaScript tests, 34 Python tests, six
Chromium browser flows, real CPU mesh conversion and independent exported-file
checks. Generated samples are in `fixtures/generated/`. **Minecraft/Blockbench
imports, real AI inference and Docker execution are not verified locally.**

## Documentation

- [Architecture & decisions](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Models & licences](docs/MODELS_AND_LICENSES.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Privacy](docs/PRIVACY.md)
- [User guide](docs/USER_GUIDE.md)
- [In-game test checklist/report](docs/GAME_TEST_REPORT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

Minecraft is a trademark of Mojang Synergies AB. This project uses the name only to
describe compatibility, following the [Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines).
# minecraft-tools
