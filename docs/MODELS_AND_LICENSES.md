# Models, third-party components and licences

Status as of 2026-10-21 on the development machine (macOS 15.7.7, Apple M4, 16 GB, **no NVIDIA GPU**).
This is an engineering inventory, not legal advice. Items marked **REVIEW** need a
competent licence review before public or commercial hosting.

## AI models

| Model                                            | Source / revision                                                                                                                  | Licence                                                                                                                                    | Hardware                                                                                       | Status here                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sking `SKING_DDJ_v101c` (render → 64×64 skin UV) | `huggingface.co/EntropyDrop/Sking`, commit `76d7a6e0755681305b4d79233abbc38efb1aa489` (downloaded 2026-10-21, 2.2 GB, 16 min 42 s) | **AGPL-3.0** (weights, runtime, mappings). Bundled BiRefNet: MIT. Bundled SigLIP2 (`google/siglip2-base-patch16-224@75de2d5`): Apache-2.0. | Linux + NVIDIA CUDA, Python 3.12, torch 2.8.0+cu128 (per `tested_environments.json`)           | Official `infer.py --verify-only` **passed**: `{"verified_files": 88, "model_version": "SKING_DDJ_v101c"}`. Inference **BLOCKED—GPU**: the runtime hard-codes CUDA (`device='cuda'`, `.cuda()`, `torch.autocast('cuda')` in `foreground_provider.py` and `batch_accessories.py`), and the launcher checks source hashes, so it cannot be patched for CPU/MPS without breaking its own provenance validation. |
| TripoSR (single image → generic mesh)            | `github.com/VAST-AI-Research/TripoSR`, weights `stabilityai/TripoSR`                                                               | MIT (code + weights per model card). Dependencies listed below.                                                                            | Official `run.py` falls back to CPU when CUDA is unavailable; README quotes ~6 GB VRAM on GPU. | Unavailable: official checkout, isolated interpreter and weights not installed. No real inference verified. CPU conversion of an uploaded mesh passed through the real worker/API.                                                                                                                                                                                                                           |
| TRELLIS / TRELLIS.2                              | `github.com/microsoft/TRELLIS`, `microsoft/TRELLIS.2-4B`                                                                           | Model listed as MIT; runtime components vary                                                                                               | Linux, ≥16 GB (TRELLIS) / ≥24 GB (TRELLIS.2) VRAM                                              | **Not integrated** in v1 (future enhancement, PLAN §4.4).                                                                                                                                                                                                                                                                                                                                                    |

### Sking (AGPL-3.0) — obligations to review (**REVIEW**)

- AGPL-3.0 §13: if a modified Sking is offered to users over a network, its
  corresponding source must be offered to those users. We do **not** modify Sking;
  we invoke the unmodified official launcher as a separate process.
- Whether invoking it as a subprocess from a hosted service creates obligations for
  the rest of this application is a legal question. Do not assume closed-source
  hosting is permitted. Until reviewed, keep `ENABLE_SKING=false` in any public deployment.
- Model weights are downloaded per deployment (never committed); keep the
  `LICENSE`, `THIRD_PARTY_NOTICES.md` and `licenses/` folder of the bundle.

## Runtime libraries (web, API, packages)

| Component          | Version                    | Licence                                                             | Use                                                                                     |
| ------------------ | -------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| React, React DOM   | 19.x                       | MIT                                                                 | UI                                                                                      |
| Vite               | 8.x                        | MIT                                                                 | build/dev server                                                                        |
| skinview3d         | 3.4.2                      | MIT                                                                 | 3D player-skin preview; its geometry is also used as an independent UV fixture in tests |
| skinview-utils     | (dependency of skinview3d) | MIT                                                                 | legacy-skin copy table used as a test reference                                         |
| three              | 0.156.1                    | MIT                                                                 | WebGL rendering                                                                         |
| @react-three/fiber | 9.x                        | MIT                                                                 | entity editor scene                                                                     |
| zod                | 4.6.x                      | MIT                                                                 | schemas                                                                                 |
| fast-png           | 8.0.0                      | MIT                                                                 | exact PNG encode/decode                                                                 |
| Express            | 5.x                        | MIT                                                                 | API                                                                                     |
| sharp (libvips)    | 0.35.x                     | Apache-2.0 (libvips LGPL-3.0, dynamically linked prebuilt binaries) | upload decode/EXIF/normalize — **REVIEW** LGPL notice in distributions                  |

Final versions are pinned in `package-lock.json`; this table is refreshed in the final report.

### Completion verification (2026-10-21)

Rechecked the [Sking v101c instructions](https://huggingface.co/EntropyDrop/Sking/blob/main/SKING_DDJ_v101c/README.md),
[TripoSR model card](https://huggingface.co/stabilityai/TripoSR) and
[official TripoSR repository](https://github.com/VAST-AI-Research/TripoSR).
Model fakes are test-only, excluded from the worker Dockerfile, and do not
establish inference capability. No GPU benchmark, output quality measurement,
or successful AI photo conversion is claimed.

Runtime diagnostics can be repeated without enabling a model:

```sh
cd services/ai-worker
.venv/bin/python -c 'import json; from app.config import get_settings; from app.adapters.sking import SkingAdapter; from app.adapters.triposr import TripoSRAdapter; s=get_settings(); print(json.dumps({"sking": SkingAdapter(s).diagnose().as_dict(), "triposr": TripoSRAdapter(s).diagnose().as_dict()}, indent=2))'
```

Observed: Sking verify-only passed (88 files, ~2 seconds), then unavailable
because parser/foreground environments are missing. TripoSR unavailable because
its official repository is missing. CUDA remains unavailable on the Apple GPU.

To configure supported hardware, follow the pinned official bundle/repository
instructions in isolated environments. Set worker `SKING_DIR`,
`SKING_PARSER_PYTHON`, `SKING_FOREGROUND_PYTHON`, or `TRIPOSR_DIR`,
`TRIPOSR_PYTHON`, `TRIPOSR_MODEL` (local directory containing `config.yaml` and
`model.ckpt`), and appropriate device/timeouts. Both API and worker have
`ENABLE_*` flags; keep them false until diagnostics, a real controlled inference,
export validation, game tests and license review have succeeded. Keep downloaded
model notices and exact commit/revision/checksums with deployment records.

Geometry libraries are pinned independently in `uv.lock` and work on CPU. The
real mesh conversion smoke uses those libraries, not TripoSR model weights.

## Reference material (not distributed)

- **Blockbench** (GPL-3.0): its Bedrock codec and `UVToLocal` were read to confirm
  coordinate/UV conventions. The resulting conversion formulas in
  `packages/bedrock-export/src/faces.ts` are a short functional transcription of
  those conventions (sign flips and lerp directions). No Blockbench code is bundled
  or shipped. **REVIEW** if you need certainty that this transcription is not a derivative work.
- Microsoft Minecraft Creator documentation (entity, manifest, geometry references).

## Assets

- No Mojang/Microsoft textures, logos, fonts, sounds or default skins are used.
- Template skins, entity templates, fixtures and the logo are generated by code in this
  repository and are original.
- Brand: "Blockwright" (developer-chosen placeholder). The site shows
  "NOT AN OFFICIAL MINECRAFT SERVICE. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT."
  per the Minecraft Usage Guidelines (<https://www.minecraft.net/en-us/usage-guidelines>).
  **REVIEW** before monetizing.
