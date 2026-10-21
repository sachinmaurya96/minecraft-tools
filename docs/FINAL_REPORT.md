# Blockwright verification report

Date: **2026-10-21 (Asia/Kolkata)**. The manual/photo-assisted application is
implemented and locally verified. Public release and actual AI/game compatibility
remain gated by the explicit untested items below.

## Implemented modules

Vite/React/TypeScript site shell, tools registry, legal/info pages and 404;
anonymous-session Express API with private upload/project/artifact ownership;
normalized multi-angle photos; classic/slim skin editor and skinview3d preview;
cuboid/bone/face entity editor and Three.js preview; deterministic photo colours
and guide-box projection; revisions/autosave/undo; validated PNG and nested
`.mcaddon` downloads; internal Python mesh voxelization/conversion; optional
Sking/TripoSR subprocess adapters with honest availability, progress and errors.

The completion pass preserved prior editor implementation and uncommitted tests,
fixed test typing and mobile layout, repaired active-job deletion/scratch retention,
added real CPU service integration and browser/file verification, and supplied
setup, CI, container definitions, fixtures and missing documentation.

## Local run commands and health verification

```sh
npm run setup
npm run build:packages
npm run dev:manual
# Or, with services/ai-worker/.venv created using uv sync --frozen:
npm run dev
```

Web: <http://localhost:5173>. Production server with built web assets was exercised
by the browser suite on port 4173 in a temporary data directory. The API/worker
smoke used ephemeral ports and removed its data directories after validation.
See DEPLOYMENT.md for persistent production and Compose configuration.

The existing development web/API/worker listeners were healthy and report manual,
photo-assisted and CPU mesh conversion ready, with both AI providers disabled.
A second `npm run dev` failed because the existing worker already owns port 8000;
the existing services were preserved. Do not start duplicate servers on those
ports. Setup was run twice and preserved local env files each time.

## Automated test results

All six Chromium acceptance tests passed, for **156 passing automated tests**
across JavaScript, Python and browser suites, plus the real service/export checks.
`npm run format:check` and `git diff --check` also passed. An offline
`npm ci --dry-run --ignore-scripts` confirmed lockfile/install consistency;
this was not a new clean installation and reported the documented Node engine warning.

| Check                                                              | Result                                                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict TypeScript, including API tests and Playwright config/tests | PASS                                                                                                                                              |
| ESLint                                                             | PASS                                                                                                                                              |
| Vitest                                                             | **116 passed**, 13 test files                                                                                                                     |
| Python pytest                                                      | **34 passed**                                                                                                                                     |
| Chromium production browser suite                                  | Routes/refresh/mobile layout, keyboard paint + undo/redo + save/reload/PNG, references, edited entity/add-on, no-WebGL fallback, privacy deletion |
| Production build                                                   | PASS                                                                                                                                              |
| Independent exported files                                         | PASS: two edited skin PNGs and three edited template add-ons                                                                                      |
| Real CPU worker/API integration                                    | PASS: generated GLB upload → actual voxelization → apply → `.mcaddon` → session deletion                                                          |
| Dependency audit during install                                    | Zero reported vulnerabilities at install time                                                                                                     |

Initial browser test selector failures were corrected against the actual UI. A
phone-width editor overflow discovered by browser acceptance was fixed with
explicit single-column sizing and shrinkable fieldsets. Screenshots/traces are
under `test-results/`; HTML report is `playwright-report/index.html`.

## Actual skin PNG validation

`fixtures/generated/classic.png` and `slim.png`: independently decoded by Pillow
as 64×64 RGBA, with exact bytes of the intended edited pixels. UV mapping,
classic/slim arms, legacy conversion, base opacity and overlay rules are covered
by package/API tests. Browser download/reload compares actual exported PNG bytes.

## Actual Bedrock add-on validation

`fixtures/generated/{humanoid,quadruped,block}.mcaddon`: generated through real
project/export services from modified models with an added cube. Python zipfile
independently verifies nested ZIP CRCs/safe paths, both pack types, four distinct
UUIDs, version/dependency linkage, entity identifiers, geometry/render controller
references, texture dimensions, UV bounds, bone hierarchy and cube limits.
Expected cube counts are 7, 9 and 2. `converted.mcaddon` is the additional real
CPU conversion sample (one merged cuboid). The game has not validated them.

## In-game Java skin test

**UNTESTED.** No Java client/version/evidence. Follow GAME_TEST_REPORT.md.

## In-game Bedrock and Blockbench test

**UNTESTED.** No Bedrock client or Blockbench version/evidence. Declared minimum
engine 1.21.0 is a manifest requirement, not an observed working client version.

## AI skin inference evidence

**BLOCKED—runtime/GPU.** Real Sking v101c bundle integrity verification passed
again (88 files). CUDA parser/foreground environments are not configured on this
Apple M4 machine; no NVIDIA CUDA device is present. Real inference did not run.
Adapter tests use explicit test fakes and cannot count as model output evidence.

## AI mesh inference/conversion evidence

**BLOCKED—model installation/inference.** TripoSR checkout, isolated inference
environment and weights are absent. Its adapter reports unavailable. Real
photo-to-mesh inference, likeness and latency were not measured. Real conversion
of a supplied mesh was tested end to end; that is manual mesh conversion, not AI.
No raw GLB is relabeled as native Minecraft content.

## Deployment and privacy/licensing limits

Docker is not installed locally, so container builds/Compose are **UNTESTED**;
their separate CI smoke stage is supplied but has not been run remotely. No live
site was published. Sking licensing review, bundled dependency notices and public
hosting/privacy policies remain operator responsibilities (MODELS_AND_LICENSES.md).

API storage/queue/rate limits assume one API process. Images and meshes have
per-file limits; rate limits do not replace filesystem capacity quotas. Before
public hosting, measure capacity, enforce host disk quotas, configure HTTPS and
correct proxy trust, and establish backup retention. Worker cleanup failures
fall back to its six-hour scratch TTL; cleanup runs every minute and at startup.
API expiry is enforced on access and swept at startup/every ten minutes.

The existing machine runs Node 24.13.0, npm 11.6.2, Python 3.12.15. All reported
checks ran there. Node **24.15+ is required for supported installs** by the locked
jsdom dependency; `.nvmrc` selects current Node 24. No global Node installation
was changed.

## Known limitations and next steps

Finish the actual Minecraft/Blockbench checklist, container CI, and real model
setup/benchmarks on suitable hardware. Keep `ENABLE_SKING=false` and
`ENABLE_TRIPOSR=false` until validated. Converted meshes are static approximations;
full rigging/animation, arbitrary Java mods, accounts and payment systems are out
of scope. Downloads should be kept before temporary server data expires.
