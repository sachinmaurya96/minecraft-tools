# Licensing inventory

Application code is currently private/UNLICENSED (`package.json`). No open-source
license is granted for it by this repository. Original generated sample textures,
models and branding were created in code here; no Mojang assets are bundled.

Pinned npm dependencies are recorded in `package-lock.json`, Python dependencies
in `services/ai-worker/uv.lock`. See [model and dependency inventory](docs/MODELS_AND_LICENSES.md)
for licenses, model provenance and unresolved review items. Preserve notices when
redistributing dependencies; the runtime's libvips binaries carry LGPL terms.

Sking is AGPL-3.0 and disabled. Its downloaded bundle, model notices and source
remain outside git under ignored `models/`. TripoSR code/weights are MIT but are
not installed or distributed here. Test fakes under `tests/fakes` exercise CLI
contracts; they are not inference implementations and are not packaged into the
production worker container.

Minecraft is a trademark of Mojang Synergies AB. This service is independent and
not approved by or associated with Mojang/Microsoft. Review branding, dependency
notices and model licensing before publishing commercially.
