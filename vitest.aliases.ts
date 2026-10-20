import { fileURLToPath } from 'node:url';

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Resolve workspace packages to their TypeScript sources in tests and the Vite
 * dev server, so a stale `dist/` can never be what gets tested.
 */
export const workspaceAliases = {
  '@blockwright/shared': root('./packages/shared/src/index.ts'),
  '@blockwright/minecraft-skin': root('./packages/minecraft-skin/src/index.ts'),
  '@blockwright/bedrock-export': root('./packages/bedrock-export/src/index.ts'),
};
