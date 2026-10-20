# Implementation status

Living log required by `plan.md` §0.12 and §16. Each phase records what was built, the
commands that were actually run, their results, and what remains blocked. Statuses:
`NOT_STARTED`, `IN_PROGRESS`, `DONE`, `DONE (with pending manual checks)`, `BLOCKED—<reason>`.

| Phase | Title | Status |
|---|---|---|
| P0 | Discovery, decision log, environment | DONE |
| P1 | Monorepo and platform shell | NOT_STARTED |
| P2 | Uploads and editor project lifecycle | NOT_STARTED |
| P3 | Playable player skin baseline | NOT_STARTED |
| P4 | Native Bedrock entity generator baseline | NOT_STARTED |
| P5 | Photo-assisted improvements | NOT_STARTED |
| P6 | Sking AI integration | NOT_STARTED |
| P7 | TripoSR and mesh-to-Bedrock conversion | NOT_STARTED |
| P8 | Security, performance, hardening | NOT_STARTED |
| P9 | QA, documentation, release | NOT_STARTED |

---

## P0 — Discovery, decision log, environment

### Environment (measured 2026-10-21)

| Item | Value | How measured |
|---|---|---|
| OS | macOS 15.7.7 (build 24G720), Darwin 24.6.0 | `sw_vers` |
| CPU | Apple M4, 10 cores | `sysctl machdep.cpu.brand_string`, `hw.ncpu` |
| RAM | 16 GB unified memory | `sysctl hw.memsize` |
| GPU | Apple M4 integrated (Metal 3). **No NVIDIA GPU, no CUDA.** | `system_profiler SPDisplaysDataType` |
| Disk free | ~255 GB | `df -h ~` |
| Node / npm | v24.13.0 / 11.6.2 | `node -v`, `npm -v` |
| Python (system) | 3.9.6 (Command Line Tools) — too old for the plan's 3.12 target | `python3 --version` |
| Python (project) | CPython 3.12.15 and 3.11.17 installed with uv 0.13.4 | `pip install --user uv`, `uv python install 3.12 3.11` |
| C toolchain | Apple clang 17.0.0; no cmake | `clang --version` |
| git | 2.39.5 | `git --version` |
| Docker | **not installed** — container builds cannot be tested here | `which docker` |

### Toolchain decisions

- Node 24 LTS (`.nvmrc`), npm workspaces, ESM everywhere.
- TypeScript pinned to **6.0.3** — TypeScript 7.0.2 is `latest`, but `typescript-eslint` 8.72 supports `<6.1.0`.
- Python **3.12.15** for the worker (matches Sking's published env), installed via uv; TripoSR gets its own venv.
- Web pins **three 0.156.1** so `skinview3d@3.4.2` (`three ^0.156.0` = 0.156.x) and `@react-three/fiber@9` (`>=0.156`)
  share one copy; `@react-three/drei` (needs `>=0.159`) is not used.

### Specs read (accessed 2026-10-21)

| Source | What was confirmed |
|---|---|
| MS Learn "Creating New Entity Types" (updated 2025-07-31) | BP entity `format_version` 1.12.0 with `is_spawnable`/`is_summonable`; client entity 1.10.0; render controller 1.8.0 (`Geometry.default`, `Material.default`, `Texture.default`); `entity`/`entity_alphatest` materials; lang keys `entity.<id>.name`, `item.spawn_egg.entity.<id>.name`; `/summon`; never use the `minecraft` namespace |
| MS Learn manifest.json reference (updated 2026-04-21) | `format_version` 2 for RP/BP (3 is preview); header name/uuid/version/min_engine_version; module types `resources`/`data`; dependency by header uuid + version |
| MS Learn geometry 1.12.0 reference (updated 2026-03-05) | per-face UV (`uv`, `uv_size`, `material_instance`) is part of 1.12.0; "omitting a face will cause that face to not get drawn" |
| Blockbench source (`js/formats/bedrock/bedrock.js`, `js/outliner/types/cube.js`, GPL-3.0, master on 2026-10-21) | X mirror on import/export, up/down per-face UV encoding, box-UV face table, `UVToLocal` face orientation, Euler order ZYX, format version bump rules |
| skinview3d 3.4.2 source | skin box-UV offsets for every part/layer (used as an independent test fixture) |
| skinview-utils (MIT) `convertSkinTo1_8` | legacy 64×32 → 64×64 copy table (used as an independent test fixture) |
| Sking `SKING_DDJ_v101c/README.md`, `infer.py`, `tested_environments.json`, runtime source | input = even square 256–4096 px front_left \| back_left composite; Linux + CUDA + Python 3.12; launcher verifies checksums + provenance; runtime hard-codes CUDA |
| TripoSR README + `run.py` + `requirements.txt` | single image input; `--device` falls back to CPU; vertex-colour `.obj`/`.glb` output; deps incl. `torchmcubes` (git), `transformers==4.35.0`, `rembg` |

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

| Package | Contents | Tests |
|---|---|---|
| `packages/shared` | zod contracts (references, skin/entity projects, jobs, capabilities, artifacts, validation reports), error codes, limits, RGBA raster ops, variance-minimising median-cut palette, border flood-fill background mask, exact PNG codec (fast-png, sub-byte/indexed/16-bit aware) | 11 |
| `packages/minecraft-skin` | 64×64 atlas layout (classic/slim), pixel lookup, validation (dimensions, base-layer opacity, overlay alpha), mirror mapping, legacy 64×32 conversion, slim detection, original template + UV-debug skins, deterministic photo projection with inferred-region reporting | 24 |
| `packages/bedrock-export` | face/UV conventions, atlas packer (exact → swatch → MODEL_TOO_COMPLEX), `.geo.json` writer, Blockbench-convention render-model reader, add-on builder, structural validator, geometry importer (per-face + box UV), templates, skin → humanoid entity | 30 |

Bugs found and fixed by these tests: median-cut split at median count blended distinct colours (now variance-minimising split), which also broke background-mask seeds.
