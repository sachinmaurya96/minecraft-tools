import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { workspaceAliases } from '../../vitest.aliases.ts';
import { activeTools, STATIC_PAGES } from './src/tools/registry.ts';

/** Writes sitemap.xml (active pages only) and robots.txt into the build output. */
function sitemap(siteUrl: string): Plugin {
  return {
    name: 'blockwright-sitemap',
    apply: 'build',
    generateBundle() {
      const base = siteUrl.replace(/\/$/, '');
      const paths = [...STATIC_PAGES, ...activeTools().map((t) => t.path)];
      const urls = paths.map((p) => `  <url><loc>${base}${p}</loc></url>`).join('\n');
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      });
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${base}/sitemap.xml\n` });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const api = 'http://127.0.0.1:4000';
  return {
    plugins: [react(), tailwindcss(), sitemap(env.VITE_SITE_URL || 'http://localhost:5173')],
    resolve: { alias: workspaceAliases },
    server: { port: 5173, strictPort: true, proxy: { '/api': api, '/health': api } },
    preview: { port: 4173, strictPort: true, proxy: { '/api': api, '/health': api } },
    build: { sourcemap: true, chunkSizeWarningLimit: 1000 },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  };
});
