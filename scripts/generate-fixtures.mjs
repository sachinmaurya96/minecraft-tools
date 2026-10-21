import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bytesToBase64, createImage, encodeRgbaPng, setPixel } from '@blockwright/shared';
import { createTemplateSkin, createUvDebugSkin } from '@blockwright/minecraft-skin';
import { ENTITY_TEMPLATES } from '@blockwright/bedrock-export';
import { loadConfig } from '../apps/api/dist/config.js';
import { createServices } from '../apps/api/dist/container.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const outputDir = path.join(root, 'fixtures/generated');

export async function generateFixtures() {
  await mkdir(outputDir, { recursive: true });
  // Exercise the real project and export services, including archive revalidation.
  const deps = await createServices(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATA_DIR: path.join(outputDir, 'data') }));
  const owner = 'fixture-generator';
  const provenance = { origin: 'template', editedAfterGeneration: false, inferredRegions: [], notes: [] };
  for (const model of ['classic', 'slim']) {
    const skin = createTemplateSkin(model);
    setPixel(skin, 9, 9, [12, 180, 230, 255]);
    const view = await deps.projects.createSkin(
      owner,
      { displayName: `Edited ${model}`, model, provenance, references: [] },
      bytesToBase64(encodeRgbaPng(skin)),
    );
    const result = await deps.exports.exportSkin(owner, view.project.id, 1);
    const { bytes } = await deps.exports.getArtifact(owner, result.artifact.id);
    await writeFile(path.join(outputDir, `${model}.png`), bytes);
    await writeFile(path.join(outputDir, `${model}.expected.rgba`), skin.data);
    await writeFile(path.join(outputDir, `${model}-uv.png`), encodeRgbaPng(createUvDebugSkin(model)));
  }
  for (const template of ENTITY_TEMPLATES) {
    const state = {
      displayName: `Edited ${template.name}`,
      identifier: `blockwright_test:${template.id}`,
      templateId: template.id,
      ...template.build(),
      behavior: { profile: 'static', health: 20, movementSpeed: 0.25 },
      provenance,
      references: [],
    };
    state.cubes.push({ id: 'fixture_hat', boneId: state.bones[0].id, origin: [-5, 34, -5], size: [10, 2, 10], color: '#a03080' });
    const view = await deps.projects.createEntity(owner, state);
    const result = await deps.exports.exportAddon(owner, view.project.id, 1, true);
    const { bytes } = await deps.exports.getArtifact(owner, result.artifact.id);
    await writeFile(path.join(outputDir, `${template.id}.mcaddon`), bytes);
    for (const raw of result.raw) {
      const data = await deps.exports.getArtifact(owner, raw.id);
      await writeFile(path.join(outputDir, raw.filename), data.bytes);
    }
    await writeFile(path.join(outputDir, `${template.id}.expected.json`), JSON.stringify({ identifier: state.identifier, cubeCount: state.cubes.length }));
  }
  // Original colour-block reference, suitable for upload/crop/photo projection checks.
  const photo = createImage(128, 256, [245, 245, 245, 255]);
  for (let y = 16; y < 240; y++)
    for (let x = 32; x < 96; x++) setPixel(photo, x, y, y < 72 ? [120, 70, 40, 255] : y < 160 ? [30, 140, 200, 255] : [50, 60, 100, 255]);
  await writeFile(path.join(outputDir, 'reference.png'), encodeRgbaPng(photo));
  console.log(`Generated real service exports in ${outputDir}`);
  return outputDir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await generateFixtures();
