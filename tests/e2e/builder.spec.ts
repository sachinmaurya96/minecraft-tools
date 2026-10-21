import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { readZip } from '../../apps/api/src/exporters/zip.js';

async function startSkin(page: Page) {
  await page.goto('/tools/character-builder/skin?new=1');
  await page.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(page.getByTestId('pixel-canvas')).toBeVisible();
  await expect(page.getByTestId('save-state')).toContainText('Saved');
}

test('navigation, truthful AI availability, mobile layout and direct route refresh', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Minecraft-ready');
  await expect(page.getByTestId('disclaimer')).toContainText('NOT AN OFFICIAL MINECRAFT SERVICE');
  for (const route of ['/tools', '/about', '/privacy', '/terms']) {
    await page.goto(route);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  await page.goto('/tools/character-builder/skin?new=1');
  await expect(page.getByRole('button', { name: 'Continue with AI' })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Use template', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/missing-tool');
  await expect(page.getByText('Nothing here but air')).toBeVisible();
});

test('skin paints with keyboard, undoes/redoes, reloads saved pixels and downloads valid PNG', async ({ page }, testInfo) => {
  await startSkin(page);
  await page.getByLabel('Project name', { exact: true }).fill('Browser skin');
  const canvas = page.getByTestId('pixel-canvas');
  await canvas.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)', exact: true }).click();
  await expect(page.getByTestId('save-state')).toContainText('Saved');
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-skin').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Browser_skin-classic.png');
  const bytes = await readFile((await download.path())!);
  const raw = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect([raw.info.width, raw.info.height, raw.info.channels]).toEqual([64, 64, 4]);
  await page.reload();
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Browser skin');
  const againPromise = page.waitForEvent('download');
  await page.getByTestId('export-skin').click();
  expect(await readFile((await (await againPromise).path())!)).toEqual(bytes);
  await page.screenshot({ path: testInfo.outputPath('skin-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('skin-mobile.png'), fullPage: true });
});

test('four reference roles upload, rotate, replace, remove and survive refresh', async ({ page }) => {
  await startSkin(page);
  await page.getByText('Reference photos', { exact: true }).click();
  await page.getByRole('checkbox', { name: /I have the right to use these images/ }).check();
  const image = await sharp({ create: { width: 100, height: 160, channels: 3, background: '#5588aa' } })
    .png()
    .toBuffer();
  for (const role of ['front', 'back', 'left', 'right']) {
    const slot = page.getByTestId(`ref-slot-${role}`);
    await slot.locator('input[type=file]').setInputFiles({ name: `${role}.png`, mimeType: 'image/png', buffer: image });
    await expect(slot.getByRole('img')).toBeVisible();
  }
  await page
    .getByTestId('ref-slot-front')
    .getByRole('button', { name: /Rotate/ })
    .click();
  const front = page.getByTestId('ref-slot-front');
  await expect(front.getByRole('img')).toHaveCSS('transform', 'matrix(0, 1, -1, 0, 0, 0)');
  await front.locator('input[type=file]').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: image });
  await page.getByRole('dialog').getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(front.getByRole('img')).toHaveAttribute('alt', /replacement.png/);
  await page.getByTestId('ref-slot-right').getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByTestId('ref-slot-right').getByRole('img')).toHaveCount(0);
  await expect(page.getByTestId('save-state')).toContainText('Saved');
  await page.reload();
  await expect(page.getByTestId('ref-slot-front').getByRole('img')).toHaveAttribute('alt', /replacement.png/);
  await expect(page.getByTestId('ref-slot-back').getByRole('img')).toBeVisible();
  await expect(page.getByTestId('ref-slot-left').getByRole('img')).toBeVisible();
  await page.getByTestId('ref-slot-front').getByRole('button', { name: 'Crop', exact: true }).click();
  const crop = page.getByLabel('Crop area. Drag to select.');
  await expect(crop).toBeVisible();
  const box = (await crop.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Apply crop', exact: true }).click();
  await expect(page.getByTestId('ref-slot-front')).toContainText('cropped');
  await page.getByRole('button', { name: 'Photo-assisted…', exact: true }).click();
  const projection = page.getByRole('dialog');
  await projection.getByRole('checkbox', { name: 'Ignore plain background (tinted red)', exact: true }).uncheck();
  await projection.getByRole('button', { name: 'Apply to skin', exact: true }).click();
  await expect(page.getByText(/Photo-assisted: \d+ faces were approximated/)).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-skin').click();
  const projected = await sharp(await readFile((await (await downloadPromise).path())!))
    .ensureAlpha()
    .raw()
    .toBuffer();
  expect([...projected.subarray((8 * 64 + 8) * 4, (8 * 64 + 8) * 4 + 4)]).toEqual([85, 136, 170, 255]);
});

test('edited cuboid entity downloads two linked Minecraft packs', async ({ page }, testInfo) => {
  await page.goto('/tools/character-builder/entity?new=1');
  await page.getByRole('button', { name: 'Use blocky humanoid', exact: true }).click();
  await expect(page.getByTestId('save-state')).toContainText('Saved');
  await page.getByLabel('Project name', { exact: true }).fill('Browser bot');
  await page.getByRole('button', { name: '+ Cube', exact: true }).click();
  await page.getByLabel('Cube name', { exact: true }).fill('Browser hat');
  await page.getByRole('tab', { name: 'Entity', exact: true }).click();
  await page.getByLabel('Namespace', { exact: true }).fill('browser_test');
  await page.getByLabel('Entity name', { exact: true }).fill('bot');
  await expect(page.getByTestId('save-state')).toContainText('Saved');
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-addon').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('browser_test_bot.mcaddon');
  const limits = { maxEntries: 64, maxEntryBytes: 16 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 };
  const outer = await readZip(await readFile((await download.path())!), limits);
  expect(outer.size).toBe(2);
  const bp = await readZip(Buffer.from(outer.get('browser_test_bot_BP.mcpack')!), limits);
  const rp = await readZip(Buffer.from(outer.get('browser_test_bot_RP.mcpack')!), limits);
  const parse = (files: Map<string, Uint8Array>, name: string) => JSON.parse(Buffer.from(files.get(name)!).toString());
  expect(parse(bp, 'manifest.json').dependencies[0].uuid).toBe(parse(rp, 'manifest.json').header.uuid);
  const geometry = parse(rp, 'models/entity/browser_test.bot.geo.json')['minecraft:geometry'][0];
  expect(geometry.bones.flatMap((b: { cubes?: unknown[] }) => b.cubes ?? [])).toHaveLength(7);
  await page.reload();
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Browser bot');
  await page.screenshot({ path: testInfo.outputPath('entity-desktop.png'), fullPage: true });
});

test('WebGL unavailable keeps the skin editor and download usable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type.toLowerCase().includes('webgl')) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await startSkin(page);
  await expect(page.getByText(/Your browser has no WebGL/i)).toBeVisible();
  await expect(page.getByTestId('export-skin')).toBeEnabled();
});

test('privacy deletion clears saved projects and the in-memory editor', async ({ page }) => {
  await startSkin(page);
  await page.getByLabel('Project name', { exact: true }).fill('Delete this skin');
  await expect(page.getByTestId('save-state')).toContainText('Saved');
  await page.getByRole('link', { name: 'Privacy & data deletion', exact: true }).click();
  await page.getByRole('button', { name: 'Delete everything', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete everything', exact: true }).click();
  await expect(page.getByText(/Deleted \d+ stored item/)).toBeVisible();
  await page.getByRole('link', { name: 'All tools', exact: true }).click();
  await page.getByRole('link', { name: 'Open Character Builder', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Continue last skin', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Make a skin', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use template', exact: true })).toBeVisible();
});
