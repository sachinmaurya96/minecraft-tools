// Deliberately validate with Python zipfile/Pillow, independent of the TS codecs.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFixtures } from './generate-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = await generateFixtures();
const python = path.join(root, 'services/ai-worker/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const result = spawnSync(python, [path.join(root, 'scripts/verify_exports.py'), output], { stdio: 'inherit' });
if (result.error) console.error(`Export verification needs the worker virtualenv: ${result.error.message}. Run uv sync in services/ai-worker.`);
process.exit(result.status ?? 1);
