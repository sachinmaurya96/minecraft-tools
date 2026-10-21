# Minecraft and Blockbench acceptance report

Date: 2026-10-21. **In-game and Blockbench inspection: UNTESTED.** No Minecraft
Java/Bedrock client or Blockbench application was used in this session. No
edition/version/build or screenshots can be claimed. Structural tests are not
proof of game compatibility. This remains a release gate in PLAN.md.

Generated artifacts for the checklist:

- `fixtures/generated/classic.png` and `slim.png`: edited original templates.
- `fixtures/generated/humanoid.mcaddon`, `quadruped.mcaddon`, `block.mcaddon`:
  user-modified templates with an extra hat cube.
- `fixtures/generated/converted.mcaddon`: real CPU mesh conversion through API.
- Matching `blockwright_test_*.geo.json` and atlas PNGs for Blockbench.

Run `npm run verify:exports` and `npm run test:integration` to regenerate them.
The manifests declare minimum engine `[1,21,0]`; **this is not a tested game version**.

## Java skin checklist

- [ ] Record Java Edition and Launcher version, OS, date and artifact SHA-256.
- [ ] Import classic PNG as Classic and slim PNG as Slim; verify arm widths.
- [ ] Inspect head/torso/limbs front, back, sides, top and bottom using UV sample.
- [ ] Paint distinct marks, export again, confirm the same in-game faces change.
- [ ] Check base opacity and translucent/empty outer layer behavior.
- [ ] Attach screenshot evidence and record any mirrored or missing faces.

## Blockbench checklist

- [ ] Record Blockbench version and artifact hash.
- [ ] Open the Bedrock `.geo.json`, load its texture PNG and inspect all faces.
- [ ] Compare preview orientation, parent bones, pivots, rotated cubes and UVs.
- [ ] Save/reopen a native Blockbench project locally and record any warnings.

## Bedrock checklist

- [ ] Record Bedrock edition/platform/exact version/build, artifact hash and date.
- [ ] Open each `.mcaddon`; both packs import with no errors.
- [ ] Activate behavior/resource packs in a disposable world; confirm dependency.
- [ ] Enable Creator Content Log; save its warnings/errors.
- [ ] `/summon blockwright_test:humanoid`, `:quadruped`, `:block`, `:converted`
      using the full namespace for each command; confirm textures, hat, scale and orientation.
- [ ] Verify spawn eggs/localized names, collisions, static/wandering profiles.
- [ ] Check negative-scale/hidden/transparent faces, rotations and bone pivots
      with an edited model.
- [ ] Exit/reopen the world and repeat spawn; attach screenshots and log evidence.

Record failures as failures; do not replace unchecked boxes with inferred passes.
