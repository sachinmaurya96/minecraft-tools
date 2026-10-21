# Character Builder guide

Choose **Player skin** for a standard player texture, or **Custom 3D entity**
for a separately spawnable Bedrock creature. A skin cannot change body geometry.

## Player skins

1. Open Character Builder → Make a skin. Pick classic (4 px arms) or slim
   (3 px), a template, blank skin, existing PNG, or the UV debug sample.
2. Paint on the atlas. Pencil, eraser (outer layer), face fill, colour picker,
   mirrored limbs, base/outer visibility, and undo/redo are available. With
   keyboard focus on the canvas, arrows move and Space paints.
3. The preview uses the actual edited PNG. Without WebGL, editing/export
   remain usable. Autosave shows the current saved revision; History restores
   an older revision by creating a new one.
4. Download skin PNG. The server validates the 64×64 atlas and required base
   opacity; the browser checks its SHA-256. Fix transparent base pixels first
   if needed.
5. Import manually in the Java Launcher skin selector and choose the matching
   arm model. Bedrock custom skin import depends on device/platform.

## Photos

Expand **Reference photos** and accept the image-use consent. Upload PNG, JPEG,
or WebP to Front, Back, Left and Right slots. Slots describe the character's own
left/right. Front is recommended; the others are optional. Rotate, crop, replace
or remove each view. Crop coordinates use the rotated image.

Use **Photo-assisted…** to position guide boxes over body regions. Adjust
background masking and review the projected result. The tool copies/samples
colours; it does not infer a faithful character automatically. Missing views
are explicitly inferred and can be painted afterward. Applying a projection
is an explicit action; inspect it before export. Entity photo colours also
provide sampled palettes, and individual cuboid faces can be painted.

## Bedrock entities

1. Choose a blocky humanoid, four-legged creature or single block. You can
   also import a skin or Bedrock `.geo.json` and optional PNG atlas.
2. Select a cube/bone in the model list. Add, duplicate, delete, move, resize,
   rotate, reparent and recolour cubes. Paint or hide individual faces.
   Camera presets show front/back/sides/top. Preview geometry is read from
   the same generated geometry used for export.
3. In Entity settings, choose a unique lowercase `namespace:entity_name`,
   static or wandering behavior, health, speed and spawn egg colours.
4. Download `.mcaddon`. Enable raw geometry/texture for Blockbench inspection.
   Raw geometry is not an installable pack. A `.bbmodel` editor project is not
   generated; import the native Bedrock geometry in Blockbench instead.
5. Open the add-on with Bedrock, activate both packs in a test world, enable
   cheats, then `/summon namespace:entity_name`. Check the Creator Content Log
   for errors. These exports have structural verification; game testing is
   still required as detailed in GAME_TEST_REPORT.md.

## Meshes and AI

With the CPU worker configured, **3D mesh → cuboids** accepts GLB/OBJ, then
voxelizes and merges the mesh into a bounded static cuboid model. Detail and
texture resolution are lost; inspect the conversion before applying it.
Generic mesh downloads are labelled non-Minecraft-native.

Sking and TripoSR adapters, job progress, cancellation and error states exist.
They stay unavailable unless both API and worker configuration permit them and
runtime diagnostics pass. Sking needs a reviewed two-view composite and a
supported CUDA environment. No real AI inference was verified on this Mac.

## Saving and deletion

Your anonymous browser session controls access. Keep downloads: server projects
expire, and clearing browser storage loses the session. Local drafts can help
recover expired/offline projects, without reference photo bytes. They are
browser-local, not cloud backups. Use Privacy → Delete everything to cancel jobs,
delete server data, and clear this browser's projects/drafts. For a conflict,
load the saved version or keep your work as a separate project.
