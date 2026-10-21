// Generate matching local API/worker credentials without replacing existing settings.
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['apps/api/.env', 'services/ai-worker/.env'];
const existing = await Promise.all(
  targets.map(async (name) => {
    try {
      return await readFile(path.join(root, name), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }),
);
const configured = existing.map((body) => (body === null ? null : parseEnv(body).AI_WORKER_TOKEN?.trim()));
if (configured.some((value, index) => existing[index] !== null && !value))
  throw new Error('An existing .env has no AI_WORKER_TOKEN. Add the same random token to both files; existing settings were preserved.');
const tokens = configured.filter(Boolean);
if (new Set(tokens).size > 1)
  throw new Error('Existing API/worker tokens differ. Set AI_WORKER_TOKEN to the same value in both .env files. Existing settings were preserved.');
const token = tokens[0] ?? randomBytes(32).toString('hex');
for (const [index, target] of targets.entries()) {
  if (existing[index] !== null) {
    console.log(`Kept ${target}`);
    continue;
  }
  const example = await readFile(path.join(root, `${target}.example`), 'utf8');
  const content = example.replace(/^AI_WORKER_TOKEN=.*$/m, `AI_WORKER_TOKEN=${token}`);
  await writeFile(path.join(root, target), content, { flag: 'wx', mode: 0o600 });
  console.log(`Created ${target}`);
}
console.log('Local settings ready. Run npm run dev (or npm run dev:manual without Python).');
