# PLAN.md — Minecraft-Inspired Tools Platform & AI Character Builder

> **Implementation specification for Claude Opus / coding agent**  
> **Revision:** 1.0 — 2026-10-21  
> **Project type:** A scalable, independently branded website for Minecraft-related creation tools.  
> **First tool:** Turn character reference photos into (A) playable Minecraft player skins and (B) custom 3D Bedrock entities.  
> **Frontend mandate:** Vite + React + TypeScript.  
> **Goal:** Deliver a real, tested end-to-end application, not a static mockup or a demo pretending to generate assets.

---

## 0. AGENT OPERATING CONTRACT — READ FIRST

You are the principal engineer and implementation agent responsible for building and verifying this product. **Do the work**, including coding, running tests, fixing failures, documenting configuration, and verifying actual downloadable files. Do not stop at creating a homepage or a code scaffold.

### Non-negotiable requirements

1. Use **Vite + React + TypeScript** for the web app. Use a modular monorepo so more Minecraft-related tools can be added without rewriting the website.
2. Deliver **both output types**, clearly separated:
   - **Player Skin:** valid 64×64 PNG for Minecraft's standard player model (classic/Steve or slim/Alex arms). It **cannot change player body geometry**.
   - **Custom 3D Entity:** actual Minecraft **Bedrock Edition add-on** (`.mcaddon`) containing matching resource and behavior packs, geometry, texture, and spawnable custom entity. It is **not** a Java player skin, and is not automatically usable as a Java mod or as a player's custom body.
3. Build a **working deterministic/manual path before optional AI pipelines**. AI quality varies, needs GPU resources, and can fail; the website must still offer honest, useful, valid exports.
4. Do **not** substitute renamed GLB/OBJ files for Minecraft `.geo.json`, or a Three.js-only scene for a Minecraft add-on. Convert and validate assets correctly.
5. Do **not** claim that a photo conversion is automatic or faithful when it is actually a template or hand-authored approximation. In the UI, distinguish `AI-generated`, `Photo-assisted`, `Manual`, and `Demo sample` outputs.
6. Do **not** invent packages, methods, model inference signatures, CLI arguments, file formats, API responses, download URLs, success messages, or successful tests. Verify against installed packages and original documentation.
7. Check license compatibility **before** integrating model weights into a hosted product. If blocked, use the non-AI workflow and document the blocker; do not quietly remove AI features or mislabel an alternate path.
8. Store model credentials on the backend, never in Vite environment variables exposed to the browser. Avoid uploading users' photos to third parties without consent.
9. Every implemented feature must have its acceptance criteria met; document explicitly anything not tested in the Minecraft game itself.
10. Prefer maintainable, functional code over speculative complexity. No payment system, accounts, database, social gallery, or Java mod compilation is required in the first release.
11. The website can have a distinct **voxel/pixel/block-inspired visual identity**, but may not suggest endorsement by Mojang/Microsoft or copy official logos, textures, fonts, or other proprietary assets.
12. Build and execute in the order below. Maintain `docs/IMPLEMENTATION_STATUS.md` with completed steps, commands run, test results, and remaining blockers.

### Definition of final delivery

A final implementation is **not complete** until all of the following exist:

- Running app shell with homepage, tool directory, and `/tools/character-builder`.
- Upload, inspect, change, and remove multi-angle reference photos.
- Working skin editor and 3D skin preview; validated PNG download.
- Working cuboid entity editor or template generator; valid Bedrock geometry and texture export.
- Correctly packaged `.mcaddon`, inspectable in Blockbench, and user instructions to import it.
- Optional AI model flows that really run when configured, with truthful disabled/unavailable/error states otherwise.
- End-to-end browser smoke tests, backend tests, archive validation, and a documented manual in-game acceptance checklist.
- README, sample `.env.example` files, model/licensing documentation, deployment instructions, and an honest verification report.

**Important reality check:** A planning document cannot itself guarantee that AI inference will work on all photos or that every future Minecraft version will accept every generated model. The agent must test the exact runtime, model versions, real exported files, and a supported Bedrock client, then make claims only about verified behavior.

---

## 1. PRODUCT VISION AND SCOPE

### 1.1 Overall website: a growing toolbox

This is not a one-off character generator. Build one Minecraft-related tools **platform** with a reusable shell and a tool registry. The first released tool is **AI Character Builder**, and future tools can include skin editing, pixel art conversion, block palettes, banner creation, item model tools, texture pack helpers, etc. These are future ideas **only**; do not implement or present them as functional at launch.

The main site should include:

- `/` — platform landing page describing the available tool.
- `/tools` — tool catalog; only active tools link to functional routes.
- `/tools/character-builder` — the first completed tool, containing the player-skin and custom-entity workflows.
- `/about`, `/privacy`, `/terms` — basic truthful site and privacy information.
- `404` page and centralized error fallback.

Use a brand name and original icon/assets chosen by the developer; **do not brand the site “Minecraft Official…”**. Add an unobtrusive but clearly visible statement: **“NOT AN OFFICIAL MINECRAFT SERVICE. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.”**

### 1.2 Audiences and jobs to be done

- **Skin user:** “I uploaded photos of my character; I want a standard Minecraft player skin I can wear.”
- **Creator user:** “I uploaded pictures of an unusual character or creature; I want a custom 3D model I can use as a spawnable entity in Bedrock.”
- **Editor user:** “The auto-generated result is not right; let me manually correct it before exporting.”
- **Future returning user:** “I want to use other Minecraft-related tools on the same site without learning a different interface.”

### 1.3 What is in scope now

**A — Player skin**

- One to four uploaded references: front required or strongly preferred; back/left/right optional.
- Clearly labeled orientation per image; reorder/replace/rotate/crop.
- Conventional player model selector: classic (4-pixel arms) / slim (3-pixel arms).
- Deterministic editable starter skin, plus import an existing skin and paint with correct UV mapping.
- Photo-guided coloring / sampled appearance as a baseline (label as `Photo-assisted`, not AI, unless an AI model was actually used).
- GPU model option to generate a 64×64 skin from suitable reference renders once configured and verified.
- 3D preview that reads the **actual exportable skin**, pixel editor, undo/redo, inner/outer layer controls.
- PNG validation and download. Provide import instructions for Java and a note that Bedrock skin import support varies by device/platform.

**B — Custom 3D entity**

- Reference photos and choice of creature/humanoid template.
- Working editor for cuboids, bones/grouping, scale, colors/textures, rotate/zoom preview.
- Generate valid Bedrock geometry (`.geo.json`), texture PNG, manifests, client/server entity JSON, render controller where appropriate, and `.mcaddon`.
- Add a minimal behavior profile that allows the custom entity to spawn. Rigged animation optional; static entities must work first.
- Optional image-to-mesh AI, then mesh cleanup, voxelization/cuboid conversion, UV bake, validation, and export. A raw generic mesh **must never bypass** conversion and packaging.
- Download raw intermediate `.glb` for inspection **only if actually generated**, clearly labeled non-Minecraft-native.
- Instructions for importing/testing in a supported Minecraft Bedrock Edition environment.

### 1.4 Explicitly out of scope for v1

- One-click Java Edition custom mob mod/JAR generation.
- Automatically installing a skin or add-on inside a user's Minecraft account/world.
- Arbitrary non-cuboid rigged Minecraft mobs with perfect animations.
- Guaranteed one-to-one likeness from arbitrary low-quality photos.
- Real-money monetization or marketplace.
- Multiplayer collaboration or user accounts.
- Running large models in a browser or promising free unlimited hosted inference.

### 1.5 Terminology that MUST remain accurate

| Term | Exact meaning in this project |
|---|---|
| Skin PNG | Standard 64×64 RGBA texture mapped to a fixed player body. |
| Classic / Slim | The two Minecraft player arm shapes; textures alone cannot create wings, horns with volume, or custom body parts. |
| Bedrock entity | New entity in a Bedrock world made from behavior + resource packs. |
| `.geo.json` | Minecraft Bedrock geometry schema, normally cuboids under bones. |
| `.mcaddon` | ZIP-format add-on package, typically combining behavior and resource pack content. |
| `.bbmodel` | Blockbench project data; useful for editing, **not** directly an installable Bedrock add-on. |
| `.glb` / `.obj` | General-purpose 3D mesh; **not** natively a usable Minecraft entity by changing the extension. |

---

## 2. TECH STACK AND ARCHITECTURE

### 2.1 Chosen stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Vite + React + TypeScript** | User requirement; modern modular UI. |
| Styles | Tailwind CSS | Responsive reusable block-inspired primitives; original assets. |
| Routing | React Router | Tool routes and expansion. |
| State | Zustand for editor session, TanStack Query for server jobs | Separate local editing from remote job states. |
| Skin preview | `skinview3d` | Renderer for normal Minecraft skins. |
| Custom model preview | Three.js + `@react-three/fiber` and drei if verified compatible | Render project cuboids and meshes in browser. |
| Client pixel editor | HTML canvas + typed UV mapping utilities | Pixel-precise 64×64 editing. |
| Validation | Zod (TypeScript), Pydantic (Python), image/ZIP validators | Shared expectations and verified output. |
| API | Node.js + Express + TypeScript | Standard API, upload authorization/limits, job orchestration. |
| AI / geometry worker | Python 3.12 + FastAPI | Model inference, image ops, mesh voxel conversion. |
| Image/3D tooling | Pillow, OpenCV, NumPy, `trimesh` (+ dependencies as validated) | Images, masks, geometry, voxelization. |
| Jobs | Initial durable local job directory + worker process, later optional Redis queue | Avoid blocking HTTP during inference. |
| Storage | Local filesystem for development; S3-compatible object storage adapter later | Simple now, production-friendly design. |
| Tests | Vitest, React Testing Library, Playwright, pytest, Supertest | Unit / API / integrated browser. |
| Packaging | Node `archiver` or Python `zipfile` (choose and verify one) | Real valid ZIP-based `.mcaddon`. |
| Deployment | Containerized API/worker + static frontend | GPU inference separated from web hosting. |

### 2.2 Architecture diagram

```text
Browser: Vite + React
  ├─ Site shell + tools registry
  ├─ Character Builder UI
  │   ├─ Multi-angle Upload / Crop / Orientation
  │   ├─ Skin Editor + skinview3d
  │   └─ Entity Editor + Three.js
  └─ Export / Job Status / Error States
             │ HTTPS
             ▼
Node/Express API
  ├─ Upload validation + storage
  ├─ Projects + job status
  ├─ Skin export validation
  ├─ Bedrock pack exporter
  └─ AI job dispatcher
             │ internal API / queue
             ▼
Python FastAPI worker
  ├─ Preprocess images, segment/crop
  ├─ Photo-assisted analysis
  ├─ Optional Sking model adapter
  ├─ Optional 3D reconstruction model adapter
  └─ Mesh → voxels → cuboids + UV/textures
             │
             ▼
Local / object artifact store
  ├─ Source images (temporary)
  ├─ 64×64 PNG skin
  ├─ Intermediate mesh (optional)
  ├─ Bedrock geometry + texture
  └─ .mcaddon
```

**Rule:** Node API manages the user-facing request lifecycle and exports; Python owns heavyweight AI/geometry. Do not call a slow GPU inference synchronously through a browser request with an unbounded timeout.

### 2.3 Repository layout

```text
voxel-tools/
├── PLAN.md
├── README.md
├── LICENSES.md
├── .gitignore
├── .env.example
├── package.json                     # npm workspaces
├── package-lock.json
├── docker-compose.yml
├── apps/
│   ├── web/                         # Vite React TypeScript
│   │   ├── src/
│   │   │   ├── app/                 # router, providers, errors
│   │   │   ├── components/          # site primitives and navigation
│   │   │   ├── features/
│   │   │   │   └── character-builder/
│   │   │   │       ├── components/
│   │   │   │       ├── editor-skin/
│   │   │   │       ├── editor-entity/
│   │   │   │       ├── hooks/
│   │   │   │       ├── services/
│   │   │   │       └── tests/
│   │   │   ├── pages/
│   │   │   ├── styles/
│   │   │   └── tools/               # central tool registry
│   │   ├── public/                  # only original/appropriately licensed assets
│   │   └── .env.example
│   └── api/                         # Express/TS REST API
│       ├── src/
│       │   ├── server.ts
│       │   ├── routes/
│       │   ├── middleware/
│       │   ├── services/
│       │   ├── validators/
│       │   ├── exporters/
│       │   ├── storage/
│       │   ├── jobs/
│       │   └── tests/
│       └── .env.example
├── services/
│   └── ai-worker/                   # isolated Python FastAPI project
│       ├── app/
│       │   ├── main.py
│       │   ├── adapters/
│       │   │   ├── sking.py
│       │   │   ├── triposr.py
│       │   │   └── optional_trellis.py
│       │   ├── preprocessing/
│       │   ├── geometry/
│       │   ├── schemas/
│       │   └── tasks/
│       ├── tests/
│       ├── pyproject.toml
│       └── .env.example
├── packages/
│   ├── shared/                      # TS API schemas, types, identifiers
│   ├── minecraft-skin/              # skin UV map, validation and conversion
│   └── bedrock-export/              # asset/manifest builders and ZIP checks
├── fixtures/
│   ├── skins/                       # original or properly licensed sample skins
│   ├── entities/                    # known-good test JSON and PNG
│   └── input-photos/                # consented/original controlled test images
├── scripts/
│   ├── verify-exports.mjs
│   └── smoke-test.sh
├── docs/
│   ├── IMPLEMENTATION_STATUS.md
│   ├── ARCHITECTURE.md
│   ├── MODELS_AND_LICENSES.md
│   ├── API.md
│   ├── DEPLOYMENT.md
│   ├── PRIVACY.md
│   ├── USER_GUIDE.md
│   ├── GAME_TEST_REPORT.md
│   └── TROUBLESHOOTING.md
└── .github/workflows/ci.yml
```

Do not add empty folders without purpose. Keep each added tool self-contained under `apps/web/src/features/<tool-id>`, with registered metadata and a typed route. Shared `skin`/`bedrock` primitives must be independent of the first tool's UI.

### 2.4 Tool registry contract

```ts
type ToolStatus = 'active' | 'coming-soon' | 'hidden';

type ToolDefinition = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  path: `/tools/${string}`;
  status: ToolStatus;
  tags: string[];
};
```

- The catalog reads from this registry instead of hardcoded page cards.
- Active entries must have a working route, usable functionality, and appropriate tests.
- Do not generate SEO landing pages claiming future tools already exist.
- Each tool can declare its own capabilities, limitations, FAQ, metadata, and export formats.

---

## 3. ACTUAL MINECRAFT COMPATIBILITY REQUIREMENTS

### 3.1 Skin path: Java Edition first

- Generate a **64×64 PNG** in the standard Minecraft skin UV atlas; support RGBA and both base/outer layers.
- Follow the **standard UV locations** for head, torso, arms, and legs. Use official/community-verifiable mapping fixtures; do not improvise atlas coordinates.
- Distinguish classic 4-pixel arms vs slim 3-pixel arms in the viewer and the output selection instructions.
- Ensure head/body/base pixels intended to be opaque are not unexpectedly transparent. Outer overlay regions may contain transparency.
- Validate dimensions, PNG signature, color mode, and required UV/alpha properties after every render/export.
- The user manually imports the PNG in Minecraft's skin selector / launcher. **Do not promise automatic installation**.
- For Bedrock player skins, document that import availability differs by device/platform; do not imply a normal Java PNG can change the geometry of a Bedrock player.
- Ship a tested pristine, appropriately licensed skin fixture; use it to validate viewer/editor/export without AI.

### 3.2 Bedrock entity path: complete add-on

A runnable custom Bedrock entity requires **more than a model**. Package a coherent pair of packs:

```text
BehaviorPack/
├── manifest.json
└── entities/
    └── <entity>.json

ResourcePack/
├── manifest.json
├── entity/
│   └── <entity>.entity.json
├── models/entity/
│   └── <entity>.geo.json
├── textures/entity/
│   └── <entity>.png
├── render_controllers/             # if the implementation uses a custom controller
│   └── <entity>.render_controllers.json
└── texts/                          # optional localization; add when needed
    ├── en_US.lang
    └── languages.json
```

Packaging:

- Use separate **unique UUIDs** for each pack header/module; cross-pack dependency UUID and version must reference the correct resource pack.
- Generate fresh UUIDs per exported add-on. Keep version arrays and `min_engine_version` appropriate to the tested Bedrock release. Use stable manifest format **2** unless an explicit compatibility test justifies version 3.
- Namespaced entity ID: `your_unique_namespace:your_entity_slug` (lowercase, digits, underscores). Never claim the reserved `minecraft:` namespace.
- Client entity references geometry identifier, texture path, materials, and render controller correctly; behavior entity has the **same** entity identifier.
- Geometry is valid Bedrock `minecraft:geometry` with sane bones, cuboids, pivots, and UV coordinates within texture bounds.
- Include spawnable/summonable settings and simple, safe movement/physics components as tested, or a deliberately static entity if chosen and documented.
- Save resource/behavior packs as two `.mcpack` ZIP files, then package them inside a `.mcaddon` ZIP. This is the documented portable structure. Validate actual archive tree before download.
- Test through Minecraft Bedrock import and summon (e.g., `/summon your_unique_namespace:your_entity_slug`); instructions must explain activating the world Behavior Pack and its Resource Pack.
- Verify geometry and texture alignment by importing into **Blockbench** and ideally in the Minecraft client. JSON schema checks alone do **not** prove the entity renders in game.

### 3.3 Java custom geometry clarification

**V1 intentionally does not export a Java-custom-character JAR.** Different Java approaches—Fabric/NeoForge mods, resource packs using specialized conventions, or display entities—have different limitations. A Bedrock `.mcaddon` cannot be directly installed in Minecraft Java Edition. A future adapter may export a Blockbench-ready model and a separately tested, version-specific mod workflow. Never label `.glb`, `.bbmodel`, or `.mcaddon` as “Works in Minecraft Java” without that implementation.

---

## 4. AI MODEL SELECTION, ENVIRONMENT AND REALISTIC LIMITS

### 4.1 Recommended model matrix — verify releases before installation

| Capability | Model/tool | Licensing note | Production decision |
|---|---|---|---|
| Image/render → skin UV | [EntropyDrop/Sking](https://huggingface.co/EntropyDrop/Sking), `SKING_DDJ_v101c` | AGPL-3.0; audit third-party dependencies and hosted-service obligations | **Optional primary AI skin adapter**, gated by verified CUDA setup and inputs |
| Standard Minecraft skin preview | [bs-community/skinview3d](https://github.com/bs-community/skinview3d) | MIT | **Required browser preview** |
| Single image → generic 3D mesh | [stabilityai/TripoSR](https://huggingface.co/stabilityai/TripoSR) | MIT model card; verify whole deployment stack | **Optional first 3D AI adapter** |
| Higher-quality image → generic 3D | [microsoft/TRELLIS-image-large](https://github.com/microsoft/TRELLIS) or [TRELLIS.2-4B](https://huggingface.co/microsoft/TRELLIS.2-4B) | Model listed as MIT; verify runtime component licenses | **Future optional enhancement**, not required for a reliable MVP |
| Minecraft native cuboid modeling | [Blockbench](https://www.blockbench.net/) + [Bedrock geometry specs](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/visualreference/geometry.v1.12.0?view=minecraft-bedrock-stable) | Respect individual tools' licenses | **Reference/QA tool and target format** |
| Mesh / cuboid processing | `trimesh`, Pillow, OpenCV, NumPy | Verify versions and transitive licenses | **Core conversion utilities**, with deterministic validation |

**Do not confuse a generic image-to-3D model with a Minecraft-native entity generator.** The generic mesh must be processed into a Minecraft-compatible cuboid geometry + texture atlas, rigged if needed, then packaged.

### 4.2 Sking: critical technical details

The currently documented `SKING_DDJ_v101c` package is a **render-to-UV** model, **not** a magical direct API accepting unrelated front/back/side photos. It expects one *edited composite image*: a **square, even-size** image (256–4096 px) with a **front-left and back-left arranged side by side**, matching Sking's own training-layout conventions. Creating the composite is an independent upstream pipeline.

Therefore implement **two separate modules**:

1. **Reference normalization / render preparation:** take photos; crop/remove background, align viewpoints, optionally synthesize consistent block-character renders. Crucially, expose the edited composite so a human can inspect/fix it before Sking inference. Never silently declare the composite correct.
2. **Sking inference adapter:** run official `SKING_DDJ_v101c/infer.py`, validate return code and 64×64 image, and attach a provenance flag to the result. Always use the **bundled launcher**, not obsolete root `infer.py` or an invented Hugging Face inference endpoint.

Reference setup from the model's published instructions:

```python
from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="EntropyDrop/Sking",
    allow_patterns=["SKING_DDJ_v101c/*"],
    local_dir="./Sking",
    # Pin `revision` to a verified commit after initial evaluation.
)
```

Reference verification and inference commands from that README (adapt absolute paths):

```bash
python ./Sking/SKING_DDJ_v101c/infer.py --verify-only

/path/to/parser-env/bin/python ./Sking/SKING_DDJ_v101c/infer.py \
  --parser-python /path/to/parser-env/bin/python \
  --foreground-python /path/to/foreground-env/bin/python \
  --input ./character_edited.png \
  --output ./character_result_v101c.png
```

- Published run target: Linux, NVIDIA CUDA, Python 3.12, multiple pinned dependencies; see model's `tested_environments.json`.
- Download the **entire v101c bundle**, not a checkpoint by itself. Model downloads do not go in Git history.
- The model card reports **no hosted Hugging Face Inference Provider for this model**; do not assume a free callable endpoint exists.
- Start AI integration with **an official example composite** and the official launcher. **Only after that** implement multi-view photo → composite preprocessing.
- Agent must record exact GPU type, VRAM, Python, CUDA/PyTorch, model revision, command, elapsed time, and an actual output image.
- If inference fails, report `UNAVAILABLE` or `FAILED` and preserve manual outputs. Never fabricate an AI-generated preview.
- **License gate:** AGPL-3.0 may impose source-sharing obligations for a network service. Obtain a competent license review for the intended distribution/hosting model; do not assume closed-source use is allowed.

Source: <https://huggingface.co/EntropyDrop/Sking/blob/main/SKING_DDJ_v101c/README.md>

### 4.3 Generic photo-to-3D adapter: TripoSR first

- TripoSR generates a general-purpose mesh from **one image**. It does **not** natively consume 4-angle photos or output ready-to-import Minecraft cuboids.
- For a multi-angle upload, select a user-approved primary image; use other photos to guide manual colors/shape reference or a future multi-view reconstruction system. Do not pass four images to a single-image interface and claim all views were used.
- Read and run the **official TripoSR repository** with an approved example input before wiring it into the API: <https://github.com/VAST-AI-Research/TripoSR>.
- Normalize mesh coordinate systems, scale and orientation; remove disconnected noise, voxelize, merge voxel groups into cuboids, bake/simplify texture UVs, export Bedrock geometry, then validate.
- This process loses details, can produce artifacts, and may exceed engine performance limits. Provide quality/resolution controls, warnings, and a manual cuboid editor.
- If the model stack or GPU cannot be installed, the deterministic cuboid-template pipeline **still** exports a real Bedrock add-on. Label that output `Template / Photo-assisted`, not `AI-generated`.

### 4.4 Upgrade route for stronger 3D

Microsoft TRELLIS/TRELLIS.2 can be researched later for better generic 3D geometry but is substantially more demanding (the original TRELLIS repo specifies Linux and a GPU with at least 16GB VRAM; TRELLIS.2 may need 24GB or more). Keep the adapter abstract, and test license/GPU/dependency compatibility separately. Do **not** make this prerequisite to releasing the first tool.

### 4.5 Model-provider interface

Define this concept (implement specific Python/TS equivalents) instead of coupling UI to one model:

```ts
type GenerationMode = 'manual' | 'photo-assisted' | 'ai';
type GenerationKind = 'skin' | 'entity';

type ProviderCapabilities = {
  id: string;
  kind: GenerationKind;
  available: boolean;
  requiresGpu: boolean;
  acceptedImageRoles: Array<'front' | 'back' | 'left' | 'right'>;
  acceptedInputFormat: string;
  outputFormat: string;
  limitations: string[];
};

type GenerationJob = {
  id: string;
  kind: GenerationKind;
  mode: GenerationMode;
  providerId: string;
  status: 'queued' | 'preprocessing' | 'running' | 'validating' | 'ready' | 'failed' | 'cancelled';
  progressStage: string;
  errorCode?: string;
  errorMessage?: string;
  artifactIds?: string[];
};
```

- Health/capabilities endpoint returns **truthful** provider availability.
- Only display an enabled “Generate with AI” action when the specific worker and weights are verified reachable; otherwise present a disabled action and a usable manual workflow.
- A “photo-assisted” operation may be deterministic; never use the AI badge for it.

---

## 5. DETAILED USER FLOWS

### 5.1 Shared start flow

1. User visits tool from the platform directory.
2. User chooses **Player Skin** or **Custom 3D Entity**; explain output compatibility in one sentence.
3. User adds front/back/left/right images, with optional slots and replace/remove controls.
4. Validate MIME and actual decoded image format, file size, dimensions, orientation, and pixel count; show clear errors.
5. Confirm right-to-use and privacy notice; user can continue without uploads by choosing a sample/template.
6. Show loaded images with role labels; provide crop/rotate and a `Use as primary image` control.
7. User selects `Manual`, `Photo-assisted`, or `AI` **only if the chosen route is genuinely supported**.
8. Process the request with progress stages; provide cancellation/retry if work is asynchronous.
9. User receives editable project—not a locked flat screenshot.
10. User reviews in 3D, adjusts details, chooses export, downloads validated asset, and reads applicable import instructions.

### 5.2 Player skin flow

1. Choose Classic or Slim.
2. Load a valid local skin template or an existing imported skin PNG.
3. Optionally construct a photo-assisted colored starter skin, indicating what was inferred vs directly copied.
4. If AI is enabled: user inspects/approves Sking composite; submit inference job; verify output.
5. Open actual 64×64 texture in pixel editor; allow pencil, eraser, color picker, fill, zoom/grid, undo/redo, layer toggles, part isolation.
6. `skinview3d` preview updates after edits and respects Classic/Slim.
7. Download PNG only after passing format/UV validation. Never output an unrelated illustration.
8. Show Java skin import steps and edition/platform notes.

### 5.3 Custom entity flow

1. Start from a **working humanoid or quadruped cuboid template** (humanoid mandatory, quadruped optional) or from an uploaded prepared project.
2. User changes cube dimensions/positions, parent bone, orientation, material/texture, and entity name. At minimum: add/remove/select/move/resize cubes, undo/redo, reset.
3. Photo-assisted option samples dominant colors and helps apply them to the template; side photos guide edits but no false claim of automatic reconstruction.
4. If AI is enabled: run primary image through TripoSR; preview the resulting mesh; run mesh-to-cuboids conversion with controllable voxel density; show a complexity/quality comparison.
5. Resolve UV atlas, texture size, missing faces, transparency, geometry limits, unique identifiers.
6. Preview the **same cuboid geometry and texture** that will be exported (not just original AI mesh).
7. Package a complete Bedrock add-on with a default basic entity behavior. Validate every file, link, and archive.
8. Offer `.mcaddon` download, optional raw `.geo.json`/texture for inspection, and exact Bedrock installation/summon instructions.
9. If the game cannot be tested in the agent's environment, state “structurally validated; in-game verification still required” rather than “works in-game”.

---

## 6. DATA MODELS AND CONTRACTS

### 6.1 Reference photos

```ts
type ImageRole = 'front' | 'back' | 'left' | 'right';

type ReferenceImage = {
  id: string;
  role: ImageRole;
  originalName: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  sizeBytes: number;
  temporaryAssetId: string;
  rotationDegrees: 0 | 90 | 180 | 270;
  crop?: { x: number; y: number; width: number; height: number };
};
```

- Roles are unique within a project; replace explicitly.
- Normalize EXIF orientation and strip unnecessary metadata.
- Never trust client-provided dimensions, IDs, MIME, paths, or image roles without backend validation.

### 6.2 Skin project

```ts
type SkinProject = {
  id: string;
  type: 'skin';
  model: 'classic' | 'slim';
  skinAssetId: string; // PNG actually stored, never merely a client URL
  generationMode: GenerationMode;
  references: ReferenceImage[];
  revision: number;
  createdAt: string;
  updatedAt: string;
};
```

Pixel editor maintains an explicit in-memory 64×64 `ImageData` or equivalent and serializes losslessly as PNG. Preserve alpha/outer layer. Undo operations should save patch/delta or bounded snapshots.

### 6.3 Entity project and normalized cuboid representation

```ts
type VoxelFace = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';

type Cube = {
  id: string;
  boneId: string;
  origin: [number, number, number];
  size: [number, number, number];
  rotation?: [number, number, number];
  pivot?: [number, number, number];
  faceTexture?: Partial<Record<VoxelFace, {
    uv: [number, number];
    uvSize: [number, number];
  }>>;
  color?: string;
};

type Bone = {
  id: string;
  name: string;
  parentId?: string;
  pivot: [number, number, number];
  rotation?: [number, number, number];
};

type EntityProject = {
  id: string;
  type: 'entity';
  displayName: string;
  identifier: string; // namespace:slug
  templateId: string;
  cubes: Cube[];
  bones: Bone[];
  textureAssetId?: string;
  generationMode: GenerationMode;
  sourceMeshAssetId?: string;
  references: ReferenceImage[];
  revision: number;
};
```

- These are **app-internal types**, not drop-in Bedrock schema. Implement an explicit converter and serializer.
- Keep consistent coordinate system assumptions in one documented module; prove them with front/back/left orientation fixtures.
- Validate finite numbers, nonnegative cube sizes, safe coordinate bounds, unique bone names, acyclic parent links, valid UVs, and bounded cube count.
- The 3D preview and exporter must read the *same serialized project representation* to avoid “looks right in browser, exports wrong in game.”

### 6.4 Job/status/artifact records

Store non-secret metadata in a local durable JSON/index or lightweight SQLite database **only if operationally needed**. Acceptable v1 path: per-job manifest + atomic file writes and a background worker; handle restart recovery. Treat `queued` and `running` as separate states and track artefact hashes/sizes. Never return raw server filesystem paths to the browser.

---

## 7. API DESIGN (VERSIONED)

All API URLs below are a proposed contract. Implement these **consistently**, with schemas, tests, clear error messages, and sample requests. Prefix `/api/v1`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | API liveness |
| GET | `/api/v1/capabilities` | Available generation modes/models, output compatibility |
| POST | `/api/v1/assets/images` | Upload a single validated reference image |
| DELETE | `/api/v1/assets/images/:id` | Remove owned temporary reference |
| POST | `/api/v1/projects/skin` | Create skin project from template/import |
| POST | `/api/v1/projects/entity` | Create entity project from template |
| GET | `/api/v1/projects/:id` | Read project metadata/state |
| PUT | `/api/v1/projects/:id` | Save editor changes, optimistic revision checks |
| POST | `/api/v1/jobs/skin-generate` | Start GPU skin generation (when available) |
| POST | `/api/v1/jobs/mesh-generate` | Start GPU mesh generation (when available) |
| POST | `/api/v1/jobs/mesh-to-cuboids` | Convert supported mesh to native cuboids |
| GET | `/api/v1/jobs/:id` | Poll status and retrieve result metadata |
| POST | `/api/v1/jobs/:id/cancel` | Best-effort cancel queued/running task |
| POST | `/api/v1/exports/skin` | Validate project PNG and create download |
| POST | `/api/v1/exports/bedrock-addon` | Validate project and package add-on |
| GET | `/api/v1/artifacts/:id/download` | Stream authorized validated artifact |

Contract rules:

- Use opaque random IDs; do not expose predictable filesystem keys.
- Standard envelope: `{ data, error, requestId }`, with consistent error codes (`BAD_IMAGE`, `INVALID_UV`, `GPU_UNAVAILABLE`, `MODEL_NOT_CONFIGURED`, `JOB_FAILED`, `EXPORT_INVALID`, etc.).
- For asynchronous jobs return **202 Accepted** plus `jobId`, then poll or use SSE if implemented and verified.
- Schema-validate all JSON; clamp bounds and reject oversized requests before allocating large tensors or voxels.
- Protect against filename traversal, decompression bombs, ZIP-slip, SSRF, malformed MIME, image parser exhaustion, and huge mesh files.
- Rate-limit upload and inference endpoints by IP/session, use quotas/cooldowns, bound concurrent GPU jobs.
- Set TTL expiry for anonymous projects/uploads and disclose it; document and implement deletion.
- No endpoints may promise progress percentages the underlying job cannot measure; stage names are sufficient.

### 7.1 Environment variable examples

Root/Node `.env.example`:

```dotenv
NODE_ENV=development
WEB_ORIGIN=http://localhost:5173
API_PORT=4000
DATA_DIR=./data
MAX_IMAGE_MB=10
MAX_IMAGE_PIXELS=20000000
MAX_IMAGES_PER_PROJECT=4
MAX_RUNNING_JOBS=1
PROJECT_TTL_HOURS=24
AI_WORKER_URL=http://127.0.0.1:8000
AI_WORKER_TOKEN=replace-with-long-random-secret
ENABLE_SKING=false
ENABLE_TRIPOSR=false
```

Worker `.env.example`:

```dotenv
WORKER_HOST=127.0.0.1
WORKER_PORT=8000
AI_WORKER_TOKEN=replace-with-same-secret
MODEL_CACHE_DIR=./model-cache
SKING_DIR=./models/Sking
TRIPOSR_DIR=./models/TripoSR
ENABLE_SKING=false
ENABLE_TRIPOSR=false
CUDA_VISIBLE_DEVICES=0
```

Use separate actual `.env` files locally, excluded from Git. Never expose `AI_WORKER_TOKEN` as `VITE_*`. For deployment replace local worker auth/networking with properly secured private service communication.

---

## 8. FRONTEND REQUIREMENTS — FUNCTIONAL SPEC, NOT A DESIGN MOCKUP

The agent should implement an original, clean, responsive **Minecraft-inspired** visual feel with pixel edges, a restrained block palette, game-like feedback, and accessible contrast. Do not copy Mojang branding. **No separate design mockups or image generation are requested by this plan.** Implement functional UI only.

### 8.1 Shared shell

- Responsive header with original logo/wordmark, links to Home/Tools/About, and a mobile nav.
- Tool directory generated from the registry, including clear “available”/“coming later” labels.
- SEO: meaningful unique titles/descriptions, canonical paths, sitemap for active pages, social metadata with original art only.
- Semantically correct buttons/links, keyboard focus states, accessible form labels, reduced motion support.
- Support dark and light theme only if it doesn't delay the actual tool; original voxel visuals are more important than theme switching.

### 8.2 Character Builder functional areas

- Workflow mode selector (`Player Skin` / `Custom Entity`) with exact supported game editions and outputs.
- Reference uploader and orientation slots; no hard requirement for all four images because users may have only one view.
- Generation method selector with model availability warnings.
- Main editor area: preview, editor controls, and an export action tied to the **current** project revision.
- Job states: input validation, upload, preprocessing, AI inference, model conversion, export validation, ready/error, retry.
- Undo/redo/reset, confirmation before destructive edits, keyboard shortcuts where appropriate.
- Small-screen behavior: preview/editor must remain usable on touch; hide advanced controls behind panels but do not remove essential functionality.
- Do not show a fake generation timer, fake success animation, or hardcoded generated results.

### 8.3 Skin viewer implementation requirements

- Create `skinview3d` viewer **after** React ref DOM element mounts; dispose it on unmount to avoid leaked WebGL contexts.
- Load uploaded/generated PNG as a blob URL or validated asset URL; revoke blob URLs when replaced.
- Support classic/slim geometry selection, mouse/touch orbit, reset camera, visible inner/outer layers, optional idle/walk animation.
- Prevent duplicate render loops under React StrictMode; test lifecycle.
- Do not embed the entire skin preview as a static screenshot.

### 8.4 Skin pixel editor requirements

- Work directly against the standard 64×64 atlas, not an arbitrary face composite.
- Overlay configurable UV boundaries and show which cube face/limb the selected pixel belongs to.
- Pencil, eraser (appropriate layers only), eyedropper, bucket fill, undo/redo, and palette.
- Zoom retains exact pixel alignment, nearest-neighbor sampling, no blurred textures.
- Base/overlay toggles, body part toggles, front/back orientation aids.
- Validate base layer transparency and re-export after editing.

### 8.5 Entity editor requirements

- The scene should render **normalized cuboids** and a bone hierarchy, not merely an imported generic GLB.
- Cube list/hierarchy, add/delete, position, dimensions, rotation, parent bone, face color or UV mapping.
- Orbit controls, view presets (front/back/left/right/top), grid/axis display and reset.
- Texture paint/coloring can begin with per-face solid colors and packed UV tiles; full freehand 3D painting may be a later enhancement.
- Complexity indicator (cube count, estimated atlas size, warnings); cap extremely complex models rather than producing huge unusable packs.
- Serialization/deserialization round trip should preserve identical shape and UVs.

---

## 9. THE MOST IMPORTANT ENGINEERING PIPELINES

### 9.1 Image ingestion and preprocessing

1. Validate file magic bytes and decoded image with server-side decoder; support PNG/JPEG/WebP, reject SVG and arbitrary files.
2. Enforce size, total pixels, and configured limits; reject corrupted files cleanly.
3. Remove EXIF metadata, normalize orientation, convert to controlled RGB/RGBA without unwanted color shifts.
4. For edited preview: safe crop, resize, optional background segmentation. Explicitly show any hallucinated/synthesized regions.
5. Store normalized images with random paths, controlled retention, content hashes, and no publicly guessable private URL.
6. Build unit fixtures for portraits, full-body photos, square images, portrait/landscape, low-res, transparent, rotated, corrupted, and duplicate inputs.
7. Gracefully explain when there is not enough visible information (e.g., missing back) and provide manual correction path.

### 9.2 Deterministic skin baseline (MUST WORK WITHOUT AI)

1. Use a verified skin template with complete classic/slim UV mapping.
2. Let user import an existing 64×64 PNG, select classic/slim and edit it.
3. Provide a photo-assisted starter workflow that samples palette choices from uploaded front/back images, **but label inferred regions** such as rear torso or occluded limbs as approximate.
4. Map base face/torso/arms/legs to an explicit UV atlas using tested coordinate fixtures.
5. Ensure consistent symmetry options and an option to manually differentiate left/right limbs.
6. Preserve base/overlay alpha and allow an optional 3D overlay for hair/clothing only within Minecraft standard skin layers.
7. Round-trip PNG → editor → PNG: check no unintended pixel changes in untouched areas.
8. Export and validate skin. This establishes a useful product **even without GPU AI**.

### 9.3 Skin AI path (Sking)

1. Install official model bundle in a separate GPU-compatible worker environment; pin model release revision and dependency versions.
2. Run official `--verify-only` and reference fixture inference; record checksums and a real output.
3. Build a reviewed reference composite conforming precisely to Sking's `front_left` / `back_left` input convention. Do not assume raw photos are ready.
4. Start with a controlled existing block-character front/back sample; visually verify against the expected UV atlas.
5. Generate a 64×64 PNG, reject malformed output, and publish it to the editor as a **new revision** (preserving ability to revert).
6. Provide a fallback when the image-preparation model is unavailable: user edits or uploads the composite image manually.
7. Test at least five categories: ordinary person, cartoon, anime-style character, strong asymmetry, accessory/hair. Inspect face/front/back matching and manually flag errors.
8. Do not claim AI feature parity with four-input conditioning unless tested: two extra side views may guide preparation, not necessarily enter Sking model directly.

### 9.4 Deterministic custom entity baseline (MUST WORK WITHOUT AI)

1. Create an original **humanoid cuboid skeleton** (head, torso, left/right arm, left/right leg) in internal cube/bone schema.
2. Add a second template only after humanoid is verified (e.g. 4-legged creature).
3. Build a reproducible UV atlas assignment algorithm for every exposed face. Begin with non-overlapping solid-color rectangular UV patches to ensure correctness.
4. Make `.geo.json` using documented Bedrock geometry schema, with valid bones and identifiers.
5. Make color/pixel texture atlas PNG and ensure all UVs point inside its bounds.
6. Generate resource pack and behavior pack manifests, client entity, behavior entity, render controller if needed, and pack PNG/strings if required by chosen format.
7. ZIP each pack as `.mcpack`; ZIP both `.mcpack` into `.mcaddon`; include only intended paths.
8. Validate ZIP CRC/readability, JSON parses, UUID uniqueness, dependencies, reference resolution, geometry IDs, UV rectangle bounds, texture dimensions, and nonempty cubes.
9. Export from a user-modified cuboid model and ensure 3D preview matches exported geometry.
10. Validate in Blockbench and Minecraft Bedrock, recording edition/version, exact steps, and screenshots or observed behavior.

### 9.5 AI-generated custom entity path (TripoSR)

1. Verify official TripoSR outputs a real generic mesh from a controlled single-image fixture.
2. Normalize mesh: correct axis/up direction, center and unit scale, remove obvious isolated artifacts, triangulate/repair if needed, and record mesh watertightness/quality warnings.
3. Generate a **bounded occupancy voxel grid** from the mesh using a verified voxelization routine; handle open surfaces and internal cavities consciously.
4. Let user choose a low/medium/high resolution preset **within measured resource bounds**; do not promise a particular cube count or fidelity.
5. Greedily merge adjacent voxels with compatible material/color into axis-aligned cuboids. Define deterministic merge order. Retain separate groups only when there is a reliable segmentation; otherwise state result is a static one-bone entity.
6. Sample/bake visible surface colors or use user-editable solid-color fallback. Build a packed 2D atlas for cuboid faces with consistent orientation; ensure atlas size limits and no UV overlaps that cause unwanted mirroring.
7. Export through **the same** Bedrock exporter/validator as the manual entity pipeline. Do not create a special unvalidated AI export format.
8. Compare browser preview to `.geo.json` imported back into the preview/parser; make this a regression test.
9. Surface warnings: volume detail lost, high cube count, missing rear view, static/no animation, fidelity uncertain.
10. If conversion fails or exceeds complexity limits, retain input photo/mesh and offer reduction or manual template editing; never provide a broken `.mcaddon` as a success.

### 9.6 Atlas algorithm and geometry safeguards

- Decide an atlas size strategy (e.g. power-of-two width/height) based on the count of projected cube faces; calculate required texels and reject beyond configured max.
- Keep textures within Bedrock-supported tested constraints; do not infer device capabilities from desktop-only behavior.
- Pack each face rectangle with unique padding if necessary; record UV rotation/origin. Write tests for all six face orientations and asymmetric patterns.
- Ensure geometry cube coordinates/pivots/bone names and `visible_bounds_*` values are correct enough for in-game rendering.
- Add configurable maximum voxels/cuboids and wall-clock/memory guards.
- A single high-density voxel per cell is an unacceptable unbounded export; greedy merge/reduce until within chosen budget or return `MODEL_TOO_COMPLEX`.
- Avoid internal-face atlas waste when cubes share surfaces, but do not remove required visible faces without verifying compatibility.

---

## 10. STEP-BY-STEP IMPLEMENTATION ROADMAP

**Implementation principle:** Finish each phase, execute the verification commands, write results to `docs/IMPLEMENTATION_STATUS.md`, and only then proceed. If a test fails, fix it before starting the next phase. Dates are deliberately not fixed because GPU hardware, model installs, and in-game QA determine elapsed time.

### PHASE 0 — Discovery, decision log, and environment

- [ ] Initialize repository, version control and `PLAN.md`.
- [ ] Verify installed Node, npm, Python, CUDA (if any), and available RAM/VRAM; document results.
- [ ] Choose supported Node LTS and Python versions according to actual library compatibility; lock toolchain and dependencies.
- [ ] Read current official specs for skin UVs, Bedrock geometry, packs, and model inference.
- [ ] Capture key decisions in `docs/ARCHITECTURE.md`: player skins target Java first; custom entity target Bedrock; AI optional and hardware-dependent.
- [ ] Write licensing matrix. Investigate AGPL/Sking, TripoSR, asset source, third-party CUDA libs before public deployment.
- [ ] Create owned test fixtures or use explicitly allowed ones with attribution.
- [ ] Decide original brand identity and obtain only original/permitted static assets; include non-affiliation statement.

**Gate P0:** README describes actual target editions, constraints and toolchain. No assumptions that free model weights mean free hosting.

### PHASE 1 — Monorepo and platform shell

- [ ] Create npm workspaces: `apps/web`, `apps/api`, `packages/shared`, `packages/minecraft-skin`, `packages/bedrock-export`.
- [ ] Scaffold Vite React TS app, Tailwind, Router, lint/formatter, Vitest.
- [ ] Implement shared layout, active tools registry, landing page, tools catalog, tool route, About, Privacy, Terms and 404.
- [ ] Implement responsive voxel-inspired original styling **in code**, no image mockups needed.
- [ ] Build proper route fallback and accessible buttons/inputs.
- [ ] Setup Express TS API with health endpoint and error/request ID middleware.
- [ ] Setup CORS, JSON limits, logging, validation, shared types.
- [ ] Add Python FastAPI health endpoint and service auth, not model loading yet.
- [ ] Add scripts to run web/API/worker in development, and verify clean installation.

**Gate P1:** Full site navigation works; `/tools/character-builder` renders functional mode selection, and web/API/worker health checks pass. No dead active-tool links.

### PHASE 2 — Uploads and editor project lifecycle

- [ ] Build drag/drop and file picker with role mapping and clear previews.
- [ ] Implement image type/size/dimension validation client + server; normalize and strip EXIF.
- [ ] Implement `POST /assets/images`, `DELETE`, and managed TTL cleanup.
- [ ] Build anonymous projects, save/load revisions, uploads ownership/session token, expiration handling.
- [ ] Build consistent `capabilities` endpoint and disabled states for AI.
- [ ] Implement recovery for refresh and stale project/session.
- [ ] Add negative tests for invalid upload, huge image, fake MIME, role duplicates, unauthorized asset access.

**Gate P2:** An uploaded photo can be retrieved into the editor; four unique view roles can be replaced/removed; missing back/side views don't crash the app.

### PHASE 3 — Playable player skin baseline

- [ ] Implement exact 64×64 standard UV utility and fixture tests.
- [ ] Build editable classic/slim skin project and import existing valid PNG.
- [ ] Integrate `skinview3d` with proper React mount/dispose lifecycle.
- [ ] Build pixel editor tools, layer controls, undo/redo, keyboard/touch basics.
- [ ] Implement deterministic photo-assisted color mapping with explicit approximation messaging.
- [ ] Add export API and download of **real PNG bytes**, MIME `image/png` and safe filename.
- [ ] Add Java/Bedrock import guidance, with distinctions.
- [ ] Test alpha, atlas, orientation, classic/slim, PNG round trips, viewer cleanup, UI save/export.

**Gate P3:** Given a test image or imported skin, user can view, edit, download a validated 64×64 PNG, and independently import it into a supported Minecraft client.

### PHASE 4 — Native Bedrock entity generator baseline

- [ ] Build internal `EntityProject` representation, original humanoid template, and cuboid editor.
- [ ] Build Three.js editor preview and front/back/side camera presets.
- [ ] Build UV atlas generator and per-face textures with tests.
- [ ] Implement verified `.geo.json` writer and matching client entity/behavior entity JSON.
- [ ] Build distinct pack manifests with UUID/dependency linkage.
- [ ] Build `.mcpack` ZIP archives and combined `.mcaddon`, no path traversal or stale cached exports.
- [ ] Implement comprehensive archive structural validator and download API.
- [ ] Test a user-modified entity, not just a hardcoded fixture.
- [ ] Open geometry in Blockbench; test `.mcaddon` in Minecraft Bedrock where available.

**Gate P4:** User customizes a cuboid entity and receives a structurally valid and **actually tested** Bedrock `.mcaddon`, or a report explicitly states pending game test. Do not mark release-ready until the in-game test is complete.

### PHASE 5 — Photo-assisted improvements

- [ ] Add crop/rotate/background mask controls with preview.
- [ ] Improve skin clothing/hair palette extraction, keeping edited pixels preserved.
- [ ] Improve entity texture sampling from reference images and manual per-face painting.
- [ ] Implement source-view orientation checks and clear warnings for missing details.
- [ ] Save/reopen projects without losing edits.
- [ ] Test realistic fixtures: front only, 2 views, 4 views, transparent/cropped photos, non-human character.

**Gate P5:** Photos materially help the editable output, while the UI truthfully explains approximations and missing-view assumptions.

### PHASE 6 — Sking AI integration (GPU-dependent, mandatory to attempt; not fake)

- [ ] Prepare Linux + NVIDIA CUDA + Python 3.12 model environment.
- [ ] Download and pin **full v101c** Sking bundle; run `--verify-only`.
- [ ] Run official inference on a valid curated composite, verify 64×64 PNG and record timings.
- [ ] Implement adapter exposing ability/status with subprocess timeout, resource guards, and structured error logs.
- [ ] Implement reviewed edited-composite preparation flow using references and user corrections. Add optional separate image-edit model only if licensed, available, and independently verified.
- [ ] Wire UI job creation/status/results into existing skin editor; never overwrite user edits without confirmation.
- [ ] Verify generated sample fidelity and known failure cases; document license and GPU requirement.
- [ ] If unavailable: keep `ENABLE_SKING=false`, show explicit reason, document exact blocker and hardware needed. **Do not claim AI skin generation works.**

**Gate P6:** Real model-generated output from actual inference is previewable and downloadable in the skin workflow on supported GPU configuration. Otherwise phase status remains `BLOCKED—GPU/MODEL`, with no false completion.

### PHASE 7 — TripoSR and mesh-to-Bedrock conversion (GPU-dependent)

- [ ] Install verified official TripoSR in isolated worker env; run controlled image-to-3D fixture.
- [ ] Write mesh normalization, bounded voxelization, greedy cuboid merge, texture projection/atlas code.
- [ ] Write integration pipeline `photo → mesh → cuboids → texture → geo.json → mcaddon`.
- [ ] Display both original mesh (when present) and final game-target cuboid model; comparison is explicit.
- [ ] Enforce complexity/timeout/memory limits and explain losses.
- [ ] Use **same exported pack validator** as Phase 4.
- [ ] Run end-to-end tests with 3+ deliberately varied shapes; inspect in Blockbench and Minecraft Bedrock.
- [ ] If unavailable, label feature unavailable and preserve photo-assisted deterministic custom entity editor/export.

**Gate P7:** At least one actual AI-generated mesh is successfully converted to a tested spawnable Bedrock entity, **not merely rendered in the browser**. Otherwise document the blocker and do not advertise AI 3D as operational.

### PHASE 8 — Security, performance, and hardening

- [ ] Add rate limits, upload quotas, concurrency limits and worker timeouts.
- [ ] Secure internal worker, artifact downloads, and anonymous project IDs.
- [ ] Sanitize exports and archive paths; use random temp directories and cleanup on error/restart.
- [ ] Add strict content type, image pixel count and mesh/ZIP bounds.
- [ ] Add graceful WebGL fallback and no-WebGL explanation.
- [ ] Keep browser responsiveness while inference runs; avoid large raw images in React global state.
- [ ] Make results accessible and reasonable on mobile.
- [ ] Add Privacy/Terms, user-upload consent, retention/delete behavior, and policy for prohibited content if hosting publicly.
- [ ] Document limitations and expected compute cost; do not promise unlimited free requests.

**Gate P8:** Security and privacy checks pass; app remains usable and truthful without optional GPUs or when workers fail.

### PHASE 9 — QA, documentation, and release

- [ ] Run frontend type check, lint, unit tests, production build.
- [ ] Run API unit/integration tests and Python tests.
- [ ] Run Playwright end-to-end flows for uploads, skin editing, entity editing, exports, error states.
- [ ] Run test on exported files with independent archive/JSON/PNG parsers.
- [ ] Test in actual Java for skin and actual Bedrock for entity; record edition/version/build and installation screenshots/notes.
- [ ] Create `docs/GAME_TEST_REPORT.md` with exact passes/failures.
- [ ] Run containerized production smoke test with AI disabled, then with AI enabled if GPU exists.
- [ ] Document production infra and AI cost/performance bounds.
- [ ] Remove test fakes, hardcoded sample-success states, unused routes, exposed secrets and non-licensed assets.
- [ ] Produce final delivery summary: what works, what was game-tested, AI availability, what remains blocked, commands to run, and where exports are located.

**Gate P9 (Release):** No broken active tools, no fake downloads, and the tested manual paths really work. AI paths get “working” status only if actual inference and target-game tests pass.

---

## 11. TEST PLAN — SPECIFIC ACCEPTANCE CASES

### 11.1 Skin tests

| ID | Test | Expected |
|---|---|---|
| SK-01 | Import valid 64×64 PNG | Editor/viewer load exact image with no unintended changes. |
| SK-02 | Import corrupt/non-PNG file | Clear rejection; no crash. |
| SK-03 | Change classic ↔ slim | Viewer arms update; chosen model documented. |
| SK-04 | Paint front head, torso, back arm, legs | Changes visible on correct 3D faces. |
| SK-05 | Overlay transparency | Inner/outer layers behave correctly. |
| SK-06 | Undo/redo then save | Pixels and revisions match expectations. |
| SK-07 | Export unchanged fixture | Valid 64×64 PNG; identical or intentionally equivalent UV contents. |
| SK-08 | Export edited project | Correct bytes, correct MIME, opens in Minecraft import UI. |
| SK-09 | No CUDA / model disabled | Manual path still works; AI cannot be falsely submitted. |
| SK-10 | Actual Sking inference | If enabled, real generated PNG + logs, not a sample. |
| SK-11 | Missing back photo | Can continue with warning and manual correction. |
| SK-12 | 4-role image upload | Roles do not overwrite one another. |

### 11.2 Entity tests

| ID | Test | Expected |
|---|---|---|
| EN-01 | Create humanoid template | Visible native cuboids. |
| EN-02 | Move/resize/add/delete cubes | Preview updates and model round-trips correctly. |
| EN-03 | Front/back/side colored UV patterns | Correct orientations after export; no unintended mirroring. |
| EN-04 | Export add-on | Valid nested ZIP with both pack manifests. |
| EN-05 | Parse geometry and entity files | Valid JSON schemas/identifiers/references. |
| EN-06 | Validate manifest UUIDs/dependency | All IDs unique, references correct. |
| EN-07 | Attempt path traversal/bad identifier | Rejected safely. |
| EN-08 | Complexity beyond cap | Clear `MODEL_TOO_COMPLEX`; no corrupt zip. |
| EN-09 | Import/inspect in Blockbench | Geometry and texture visibly match preview. |
| EN-10 | Import `.mcaddon` into Bedrock | Packs import and activate; entity spawns via `/summon`. |
| EN-11 | Failed AI mesh inference | Template/edit/export still works. |
| EN-12 | Real AI mesh → cuboids | Result is native Bedrock geometry, not renamed GLB. |
| EN-13 | Downloaded add-on metadata | Accurate content type/name, no hidden missing files. |

### 11.3 Website, API, and system tests

- Routes load directly after browser refresh on deployed server.
- Inactive tool registry items cannot be reached as functioning tools by mistake.
- Mobile navigation, upload and exports usable at phone widths.
- Keyboard and screen-reader names for form controls and actionable icons.
- Worker unavailable: clear message, retries safe, no lost edits.
- User A cannot download User B's private temporary assets with guessed IDs.
- Upload of EXIF photo doesn't leak unwanted metadata to exports.
- Client manipulation of MIME/name/size cannot bypass backend validation.
- Worker crash/restart doesn't leave jobs permanently “running”; stale jobs recover or fail cleanly.
- Invalid PNG/ZIP/JSON cannot be presented as a completed artifact.
- Temporary files are removed after TTL and on user deletion.

### 11.4 Independent verification scripts

Implement a script that verifies:

1. PNG has expected dimensions, is parsable, RGBA-capable and has proper atlas placement against fixtures.
2. `.mcaddon` opens as ZIP and contains two valid `.mcpack` ZIPs.
3. Both pack manifests parse and use distinct proper UUIDs.
4. Resource pack client entity ID matches behavior entity ID.
5. Geometry identifier matches client entity geometry reference.
6. Texture reference path exists and texture dimensions match geometry description.
7. Every UV rectangle lies within the atlas and every bone parent resolves.
8. Cube count/size/coordinates are under configured limits.
9. No ZIP entry uses absolute paths or `..`.
10. Failure returns nonzero exit code for CI.

This validation is **necessary but not sufficient** for game compatibility; test inside Minecraft separately.

---

## 12. DEVELOPMENT COMMANDS AND ENGINEERING QUALITY

Create actual root `package.json` scripts based on these concrete starter commands (and create the matching scripts inside each workspace):

```json
{
  "scripts": {
    "dev": "concurrently -k -n WEB,API,WORKER \"npm run dev:web\" \"npm run dev:api\" \"npm run dev:worker\"",
    "dev:web": "npm run dev -w apps/web",
    "dev:api": "npm run dev -w apps/api",
    "dev:worker": "python -m uvicorn app.main:app --app-dir services/ai-worker --reload --host 127.0.0.1 --port 8000",
    "build": "npm run build -w packages/shared && npm run build -w packages/minecraft-skin && npm run build -w packages/bedrock-export && npm run build -w apps/api && npm run build -w apps/web",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "test:e2e": "playwright test",
    "test:python": "python -m pytest services/ai-worker/tests",
    "verify:exports": "node scripts/verify-exports.mjs"
  }
}
```

Install `concurrently` and `@playwright/test` at the root, plus `uvicorn` and `pytest` in the Python worker environment. Define the required build/dev/test scripts for each workspace; make sure the npm workspaces are configured in the root `package.json`. In the first working commit, verify all commands on the **actual selected OS/shell and Python environment** and adjust as needed (especially Python virtual-environment interpreter paths). Do not paste these commands without testing. Pin dependency versions via lock files. Add `.nvmrc` if appropriate.

Minimum CI stages:

- `npm ci`
- Typecheck + lint
- Unit/API tests
- Production web build
- Python environment install/test (CPU-compatible subset)
- Export verification on deterministic fixtures
- Playwright smoke test in headless browser
- Upload dependency/model-license review evidence (manual approval before commercial launch)

GPU integration tests should run in a separate, labeled pipeline on GPU hardware; do not fail CPU CI for missing CUDA, and do not mark missing GPU tests as passed.

---

## 13. DEPLOYMENT AND COST STRATEGY

### 13.1 Local development / zero GPU

- Web runs via Vite dev server (e.g. port 5173).
- Express API runs on a separate local port (e.g. 4000).
- Python geometry/image worker may run on CPU for non-AI work; GPU-only adapters report disabled.
- Both manual player-skin and manual Bedrock-entity paths should be end-to-end functional **with no paid AI API**.
- This configuration can be tested even on a MacBook; Linux/CUDA-only model requirements must be isolated.

### 13.2 Hosting split

- Static web: any suitable static host/CDN supporting SPA fallback routing.
- Node API: container or server with appropriate upload/storage isolation.
- Python worker: separate container/host, CPU for preprocessing, dedicated NVIDIA GPU for enabled models.
- Object storage: S3-compatible private buckets and short-lived signed downloads when moving beyond local disk.
- Job queue: start simple, add Redis/BullMQ or durable managed queue when production volume requires it.

### 13.3 Expense and product constraints

- Open model weights are not free GPU compute.
- Avoid holding a large GPU online if infrequent usage makes on-demand jobs more economical.
- Give users clear quotas/progress/queues instead of unrestricted AI requests that could exhaust resources.
- No guesses about free Hugging Face Spaces uptime or free inference endpoints; verify current quotas and license terms before relying on them.
- Document estimated GPU RAM and benchmark latency **from real tests**, not invented performance figures.
- Add per-job compute telemetry and kill limits to avoid accidental cost overruns.

---

## 14. PRIVACY, CONTENT, AND BRAND REQUIREMENTS

- User portraits may include faces or children. Show a short, understandable upload notice and avoid permanent storage by default.
- Require users to confirm permission to use uploaded images; do not ask for more personal data than needed.
- Strip metadata, use private storage, minimize retention, implement delete action and scheduled deletion.
- Do not train or fine-tune on uploads without separate explicit consent.
- If optional third-party inference is used, disclose the provider and obtain informed consent before upload.
- Apply safe content/malware/abuse controls suitable for a general-audience gaming website; do not build a public user image gallery without separate safeguards.
- Follow the Minecraft Usage Guidelines: use original brand/graphics, avoid official Mojang/Microsoft assets as branding, make association disclaimer prominent, and ensure legal review before monetizing: <https://www.minecraft.net/en-us/usage-guidelines>.
- Review each model's code/weights licenses, third-party image segmentation model licenses, code obligations, required attribution and commercial restrictions.
- No unlicensed Minecraft soundtrack/textures/logos/fonts in website assets or downloadable packs.

---

## 15. TROUBLESHOOTING AND FAILURE BEHAVIOR

| Problem | Required handling |
|---|---|
| User uploads front only | Continue with warning; manual editing; label inferred/unseen back. |
| Image is tiny/blurry/cropped | Show quality warning, crop controls or reject if technically unusable. |
| Skin AI has no GPU | Disable `AI Skin`, preserve manual/photo-assisted editing. |
| Sking composite is wrong layout | Reject or request corrected composite; never silently run with false success. |
| Sking model launcher fails | Log safe details, mark failed, allow retry/manual route. |
| TripoSR output is open/noisy | Warn, repair/voxelize if feasible, reduce complexity, fallback manual. |
| Mesh generates too many cuboids | Reduce voxel resolution, merge faces, or return clear limit error. |
| Texture/UV mismatch | Block export, run atlas debugging fixture and fix coordinate transform. |
| Archive lacks expected resources | Fail server export and unit test; never offer download as success. |
| Bedrock import works but entity is invisible | Check client geometry ID, texture path, renderer, material, visible bounds; inspect content logs. |
| Entity does not summon | Check namespace/identifier, pack activation, behavior JSON and version. |
| Browser WebGL unsupported | Explain unsupported 3D preview; allow 2D editor/export if safe. |
| Network/browser refresh during generation | Poll persisted job ID; show status or recover safely. |
| Storage quota/TTL exceeded | Clear expiry/purge message, no silent corruption. |

---

## 16. CLAUDE AGENT EXECUTION PROTOCOL

Use these instructions when handing this file to Claude Opus. Prefer the agent working inside a real repository with terminal access, not generating isolated code snippets in chat.

### Step A — First action

Read `PLAN.md` fully. Inspect current working directory and runtime. Create `docs/IMPLEMENTATION_STATUS.md` with all phases `NOT_STARTED`. Confirm actual supported dependencies and external formats from source docs. Start Phase 0.

### Step B — Implement incrementally

For each phase:

1. State the files/features you are implementing in your internal status document.
2. Implement complete vertical slice of code, schemas, and tests.
3. Run all phase-specific commands in the terminal.
4. Fix all actionable failures; do not skip broken tests or pretend a feature is complete.
5. Save a working commit (if Git is available), and update implementation status with command outputs and known limitations.
6. Continue to the next phase **without needing the user to repeatedly restate the goal**. Ask only if truly blocked by unavailable credentials, unavailable machine access, legal approval, or a product choice the plan does not resolve.

### Step C — Never use fake AI as the default

When GPU models are not installed, a user should still be able to produce genuine valid assets via manual/photo-assisted mode. The app must not show a stock screenshot then claim it was generated from uploaded photos. Use sample fixtures only when the user explicitly selects a sample and label them as such.

### Step D — Explicit feature flags

- `ENABLE_SKING=false` by default; set true only after actual official inference success.
- `ENABLE_TRIPOSR=false` by default; set true only after actual inference and successful native conversion.
- API `/capabilities` must report **runtime readiness**, not merely flags.
- UI must reflect capability state and provenance.
- Export permission depends on **asset validation**, not on whether an AI provider is installed.

### Step E — Release report format

At the end, write `docs/FINAL_REPORT.md` with:

```markdown
# Final implementation report

## Implemented modules
## Local run commands (actually tested)
## Model setup and GPU requirements
## Automated test results and dates
## Actual skin PNG validation result
## Actual Bedrock .mcaddon validation result
## In-game Java skin test (edition/version/evidence or UNTESTED)
## In-game Bedrock entity test (edition/version/evidence or UNTESTED)
## AI skin inference evidence or BLOCKED
## AI mesh inference/conversion evidence or BLOCKED
## Privacy/licensing risks requiring review
## Known limitations and next steps
```

Do not say “100% working” if in-game tests were not performed or GPU features were not verified.

---

## 17. PRODUCT MILESTONES / RELEASE POLICY

| Milestone | What user gets | Release criterion |
|---|---|---|
| **M1 — Platform foundation** | Functional website and tool directory | Phase 1 passes |
| **M2 — Working skin builder** | Editable standard Minecraft PNG + 3D preview | Phase 3 passes and real game skin import tested |
| **M3 — Working Bedrock entity builder** | Editable cuboid entity + `.mcaddon` | Phase 4 passes and Bedrock import/spawn tested |
| **M4 — Photo-assisted tool** | Upload-based palette/appearance help | Phase 5 passes with truthful UX |
| **M5 — AI skin generation** | Actual Sking inference + validated PNG | Phase 6 passes on GPU; otherwise not enabled |
| **M6 — AI 3D conversion** | TripoSR mesh → native Bedrock entity | Phase 7 passes including target-game test |
| **M7 — Public launch** | Secure, stable first tool on future-ready platform | Phases 8–9 pass and licensing/privacy reviewed |

**Recommended launch strategy:** publicize the **truly tested capabilities** as they reach their milestones. It is better to ship excellent manual skin and entity exports before promising AI photo conversion than to offer fake instant generation.

---

## 18. FUTURE TOOLS ARCHITECTURE (PLAN ONLY — DO NOT BUILD YET)

This website will grow. Design internal contracts so future tools can add:

- A route and catalog entry.
- Optional frontend editor module.
- Optional backend endpoints.
- Optional worker/AI provider.
- Independent output validators/exporters.
- Tool-specific metadata, permissions and usage limits.

Potential later tools: skin recolor/remix, Minecraft pixel-art converter, mob recolor, banner/shield designer, block palette planner, item/block model generator, texture pack maker, schematic helpers, structure converter. These are **ideas**, not promised features. Keep the first tool cohesive and avoid premature implementation of this roadmap.

---

## 19. AUTHORITATIVE REFERENCES — READ BEFORE CODING

### Minecraft and model formats

1. **Official Minecraft usage and fan-brand guidelines:** <https://www.minecraft.net/en-us/usage-guidelines>
2. **Minecraft Bedrock Creating New Entity Types:** <https://learn.microsoft.com/en-us/minecraft/creator/documents/introductiontoaddentity?view=minecraft-bedrock-stable>
3. **Minecraft Bedrock Entity Wizard/Blockbench workflow:** <https://learn.microsoft.com/en-us/minecraft/creator/documents/minecraftentitywizard?view=minecraft-bedrock-stable>
4. **Minecraft Bedrock geometry schema (`v1.12.0+`):** <https://learn.microsoft.com/en-us/minecraft/creator/reference/content/visualreference/geometry.v1.12.0?view=minecraft-bedrock-stable>
5. **Minecraft Bedrock pack manifest reference:** <https://learn.microsoft.com/en-us/minecraft/creator/reference/content/addonsreference/packmanifest?view=minecraft-bedrock-stable>
6. **Official Minecraft file extensions (`.mcaddon`, `.mcpack`):** <https://learn.microsoft.com/en-us/minecraft/creator/documents/minecraftfileextensions?view=minecraft-bedrock-stable>
7. **Blockbench supported formats:** <https://www.blockbench.net/wiki/blockbench/formats/>
8. **Blockbench `.bbmodel` documentation:** <https://www.blockbench.net/wiki/docs/bbmodel/>

### AI and frontend tooling

9. **Sking model card and license:** <https://huggingface.co/EntropyDrop/Sking>
10. **Sking `SKING_DDJ_v101c` exact run instructions:** <https://huggingface.co/EntropyDrop/Sking/blob/main/SKING_DDJ_v101c/README.md>
11. **TripoSR model card (MIT, single image):** <https://huggingface.co/stabilityai/TripoSR>
12. **TripoSR official source:** <https://github.com/VAST-AI-Research/TripoSR>
13. **TRELLIS official repo:** <https://github.com/microsoft/TRELLIS>
14. **TRELLIS.2 Hugging Face:** <https://huggingface.co/microsoft/TRELLIS.2-4B>
15. **skinview3d:** <https://github.com/bs-community/skinview3d>
16. **Vite:** <https://vite.dev/guide/>
17. **React:** <https://react.dev/>
18. **Three.js:** <https://threejs.org/docs/>

**Maintenance rule:** Versions and licenses change. Record access date, revision/commit/lockfile for dependencies and model weights. Official Minecraft creator documentation and an actual target-game test take precedence over blog posts or assumptions. Update this plan only after recording the reason.

---

## 20. FINAL CHECKLIST — SHIP ONLY WHAT IS ACTUALLY VERIFIED

### Website

- [ ] Vite React + TypeScript build passes.
- [ ] Functional home/tools/character-builder routes with accessible navigation.
- [ ] Original voxel-themed identity and non-affiliation disclaimer.
- [ ] Future tool modules can be registered without modifying existing export engines.

### Player skin

- [ ] Images upload and role mapping works.
- [ ] Standard 64×64 skin editor works, including both arm widths and overlay.
- [ ] Preview shows the actual generated or edited PNG.
- [ ] Exported PNG validates and was tested importing into Minecraft.
- [ ] AI mode truthfully reflects whether Sking actually runs.

### Bedrock entity

- [ ] Editable cuboid project works and reopens reliably.
- [ ] Geometry and texture have valid UVs and matching identifiers.
- [ ] Behavior and resource packs both exist, dependency linkage valid.
- [ ] Exported `.mcaddon` is valid and tested in Bedrock.
- [ ] Raw GLB is never mislabeled as native Minecraft content.
- [ ] AI mesh conversion truthfully reflects whether TripoSR and voxel conversion actually ran.

### Operational

- [ ] Client/API/worker start using documented commands.
- [ ] Automated suites and independent output validators pass.
- [ ] In-game verification records exact supported game version.
- [ ] User-upload privacy, deletion, and security controls work.
- [ ] No secrets or unlicensed assets are checked into repository.
- [ ] Model licenses, hardware limits and cost implications are documented.
- [ ] `docs/FINAL_REPORT.md` explicitly marks anything untested or blocked.

**END OF PLAN — Begin at Phase 0 and implement the complete product one verified vertical slice at a time.**
