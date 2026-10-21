# Implementation status

Living log required by `plan.md` §0.12 and §16. Each phase records what was built, the
commands that were actually run, their results, and what remains blocked. Statuses:
`NOT_STARTED`, `IN_PROGRESS`, `DONE`, `DONE (with pending manual checks)`, `BLOCKED—<reason>`.

| Phase | Title                                    | Status                                                                          |
| ----- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| P0    | Discovery, decision log, environment     | DONE                                                                            |
| P1    | Monorepo and platform shell              | DONE                                                                            |
| P2    | Uploads and editor project lifecycle     | DONE                                                                            |
| P3    | Playable player skin baseline            | DONE (with pending manual game checks)                                          |
| P4    | Native Bedrock entity generator baseline | DONE (with pending manual game/Blockbench checks)                               |
| P5    | Photo-assisted improvements              | DONE                                                                            |
| P6    | Sking AI integration                     | BLOCKED—CUDA environments/GPU inference; adapter and disabled UX implemented    |
| P7    | TripoSR and mesh-to-Bedrock conversion   | BLOCKED—real TripoSR installation/inference; CPU mesh conversion verified       |
| P8    | Security, performance, hardening         | DONE for local single-process use; public capacity review pending               |
| P9    | QA, documentation, release               | DONE (with pending game, GPU and container checks); not public-release approved |

---

## P0 — Discovery, decision log, environment

### Environment (measured 2026-10-21)

| Item             | Value                                                           | How measured                                           |
| ---------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| OS               | macOS 15.7.7 (build 24G720), Darwin 24.6.0                      | `sw_vers`                                              |
| CPU              | Apple M4, 10 cores                                              | `sysctl machdep.cpu.brand_string`, `hw.ncpu`           |
| RAM              | 16 GB unified memory                                            | `sysctl hw.memsize`                                    |
| GPU              | Apple M4 integrated (Metal 3). **No NVIDIA GPU, no CUDA.**      | `system_profiler SPDisplaysDataType`                   |
| Disk free        | ~255 GB                                                         | `df -h ~`                                              |
| Node / npm       | v24.13.0 / 11.6.2                                               | `node -v`, `npm -v`                                    |
| Python (system)  | 3.9.6 (Command Line Tools) — too old for the plan's 3.12 target | `python3 --version`                                    |
| Python (project) | CPython 3.12.15 and 3.11.17 installed with uv 0.13.4            | `pip install --user uv`, `uv python install 3.12 3.11` |
| C toolchain      | Apple clang 17.0.0; no cmake                                    | `clang --version`                                      |
| git              | 2.39.5                                                          | `git --version`                                        |
| Docker           | **not installed** — container builds cannot be tested here      | `which docker`                                         |

### Toolchain decisions

- Node 24 LTS (`.nvmrc`), npm workspaces, ESM everywhere.
- TypeScript pinned to **6.0.3** — TypeScript 7.0.2 is `latest`, but `typescript-eslint` 8.72 supports `<6.1.0`.
- Python **3.12.15** for the worker (matches Sking's published env), installed via uv; TripoSR gets its own venv.
- Web pins **three 0.156.1** so `skinview3d@3.4.2` (`three ^0.156.0` = 0.156.x) and `@react-three/fiber@9` (`>=0.156`)
  share one copy; `@react-three/drei` (needs `>=0.159`) is not used.

### Specs read (accessed 2026-10-21)

| Source                                                                                                          | What was confirmed                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MS Learn "Creating New Entity Types" (updated 2025-07-31)                                                       | BP entity `format_version` 1.12.0 with `is_spawnable`/`is_summonable`; client entity 1.10.0; render controller 1.8.0 (`Geometry.default`, `Material.default`, `Texture.default`); `entity`/`entity_alphatest` materials; lang keys `entity.<id>.name`, `item.spawn_egg.entity.<id>.name`; `/summon`; never use the `minecraft` namespace |
| MS Learn manifest.json reference (updated 2026-04-21)                                                           | `format_version` 2 for RP/BP (3 is preview); header name/uuid/version/min_engine_version; module types `resources`/`data`; dependency by header uuid + version                                                                                                                                                                           |
| MS Learn geometry 1.12.0 reference (updated 2026-03-05)                                                         | per-face UV (`uv`, `uv_size`, `material_instance`) is part of 1.12.0; "omitting a face will cause that face to not get drawn"                                                                                                                                                                                                            |
| Blockbench source (`js/formats/bedrock/bedrock.js`, `js/outliner/types/cube.js`, GPL-3.0, master on 2026-10-21) | X mirror on import/export, up/down per-face UV encoding, box-UV face table, `UVToLocal` face orientation, Euler order ZYX, format version bump rules                                                                                                                                                                                     |
| skinview3d 3.4.2 source                                                                                         | skin box-UV offsets for every part/layer (used as an independent test fixture)                                                                                                                                                                                                                                                           |
| skinview-utils (MIT) `convertSkinTo1_8`                                                                         | legacy 64×32 → 64×64 copy table (used as an independent test fixture)                                                                                                                                                                                                                                                                    |
| Sking `SKING_DDJ_v101c/README.md`, `infer.py`, `tested_environments.json`, runtime source                       | input = even square 256–4096 px front_left \| back_left composite; Linux + CUDA + Python 3.12; launcher verifies checksums + provenance; runtime hard-codes CUDA                                                                                                                                                                         |
| TripoSR README + `run.py` + `requirements.txt`                                                                  | single image input; `--device` falls back to CPU; vertex-colour `.obj`/`.glb` output; deps incl. `torchmcubes` (git), `transformers==4.35.0`, `rembg`                                                                                                                                                                                    |

### Commands run (P0)

```text
uv python install 3.12 3.11                          -> cpython-3.12.15, 3.11.17
snapshot_download(EntropyDrop/Sking, SKING_DDJ_v101c/*, revision=76d7a6e...)  -> 2.2 GB in 16m42s
python3.12 ./Sking/SKING_DDJ_v101c/infer.py --verify-only
  -> {"verified_files": 88, "model_version": "SKING_DDJ_v101c"}  (exit 0, 1.17 s)
```

### Gate P0

- [x] README states target editions (skins: Java first; entities: Bedrock add-on), constraints and toolchain.
- [x] Licensing matrix in `docs/MODELS_AND_LICENSES.md` (Sking AGPL flagged for review; "free weights ≠ free hosting" noted).
- [x] Decisions in `docs/ARCHITECTURE.md`.
- [x] Original brand ("Blockwright") and non-affiliation statement; all fixtures generated in-repo.

**P0: DONE.**

### Foundation packages (built ahead of P1 because every later phase depends on them)

| Package                   | Contents                                                                                                                                                                                                                                                                        | Tests |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `packages/shared`         | zod contracts (references, skin/entity projects, jobs, capabilities, artifacts, validation reports), error codes, limits, RGBA raster ops, variance-minimising median-cut palette, border flood-fill background mask, exact PNG codec (fast-png, sub-byte/indexed/16-bit aware) | 11    |
| `packages/minecraft-skin` | 64×64 atlas layout (classic/slim), pixel lookup, validation (dimensions, base-layer opacity, overlay alpha), mirror mapping, legacy 64×32 conversion, slim detection, original template + UV-debug skins, deterministic photo projection with inferred-region reporting         | 24    |
| `packages/bedrock-export` | face/UV conventions, atlas packer (exact → swatch → MODEL_TOO_COMPLEX), `.geo.json` writer, Blockbench-convention render-model reader, add-on builder, structural validator, geometry importer (per-face + box UV), templates, skin → humanoid entity                           | 30    |

Bugs found and fixed by these tests: median-cut split at median count blended distinct colours (now variance-minimising split), which also broke background-mask seeds.

## Completion pass — 2026-10-21

Follow-up startup fix: stopped the confirmed old project servers causing the
port-8000 collision. Fixed worker launcher signal handling/process-group cleanup
in `scripts/worker.mjs`. Verified `npm run dev` starts web/API/worker, all three
respond HTTP 200, and Ctrl+C stops the worker reloader and releases the ports.
The verification servers were stopped so the user's terminal can start them.

Final totals: **116 JavaScript + 34 Python + 6 Chromium tests passed**.
Typechecks, lint, formatting, production build and independent exports passed.
The local preview at `http://localhost:5173` and API/worker health were confirmed;
existing development services were preserved when a duplicate startup found port 8000 occupied.

The previous implementation already contained the editors, photo-assisted tools,
API and optional worker adapters, despite the old status table. Existing
uncommitted API/web tests were preserved and completed. This pass supplied the
missing verification, developer setup, deployment and handover pieces.

### Implemented and verified

- P1–P2: registered site routes, SPA refresh, responsive navigation, session-scoped
  normalized uploads, four roles, project revisions/conflicts, retention/deletion.
- P3: classic/slim atlas, editable PNG, undo/redo, actual 3D preview, strict export;
  keyboard paint, reload and identical PNG downloads exercised in Chromium.
- P4: template and edited cuboids, grouping/UVs, matching geometry/texture, distinct
  linked packs; edited entity exported and reopened after reload in Chromium.
- P5: reference rotate/crop/replace/remove, deterministic guide-box projection and
  palettes. Missing views are labeled approximate; photo-assisted is not AI.
- P6–P7: existing real-launcher adapters and truthful capability/job UI retained.
  Real CPU mesh upload → worker conversion → API validation → project apply →
  add-on export passed without test fakes. AI inference remains unavailable.
- P8: fixed active-job privacy deletion race, removed worker input/output copies
  after collection, added startup/periodic scratch TTL cleanup, reset browser
  editor memory after deletion, fixed narrow-screen fieldset/grid overflow, and
  released completed per-project locks instead of retaining them indefinitely.
- P9: actual ESLint configuration/dependencies, strict test typechecks, production
  Playwright suite, independent Pillow/zipfile export verifier, original generated
  fixtures, matched local setup, CPU Dockerfiles/Compose and CI stages, all README
  documentation links supplied. No deployment or commit was performed.

### Commands and evidence

| Command                     | Result                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm run setup`             | Existing local env files preserved; matching-token check passed                                                                   |
| `npm run typecheck`         | Passed, including test and Playwright types                                                                                       |
| `npm run lint`              | Passed                                                                                                                            |
| `npm test`                  | 116 passed: shared 11, skin 24, Bedrock 30, API 35, web 16                                                                        |
| `npm run test:python`       | 34 passed; fakes confined to test directories                                                                                     |
| `npm run build`             | Packages/API/web production build passed                                                                                          |
| `npm run verify:exports`    | Classic/slim exact RGBA PNG and edited humanoid/quadruped/block packs passed independent Python parsing                           |
| `npm run test:integration`  | Real Python worker/API conversion and session deletion passed; `converted.mcaddon` independently verified                         |
| `npm run test:e2e`          | Chromium: routes, manual skin/export, references, entity/export, no-WebGL fallback, deletion; desktop/mobile screenshots retained |
| Sking runtime diagnostics   | Official bundle verify-only passed: 88 files, v101c; CUDA parser/foreground environments missing                                  |
| TripoSR runtime diagnostics | Unavailable: official repository/environment/weights not installed                                                                |

Tests involving HTTP/browser servers require local socket permission. Initial
sandbox `listen EPERM` failures were rerun successfully with local server access.
The in-app Browser bootstrap failed (`node:process` import restricted); local
browser acceptance used the repository's Playwright/Chromium runner instead.

### Remaining external gates

Minecraft Java/Bedrock imports, Blockbench inspection, real GPU inference and
Docker execution were **not performed**. See `GAME_TEST_REPORT.md` and
`FINAL_REPORT.md`. This is a working local manual/photo-assisted application,
not a verified public AI service. Public capacity, model licensing and the game
acceptance gate must be completed before advertising those capabilities.
