/**
 * Central tool registry (PLAN §2.4). Pure data: the catalog, routes, sitemap and
 * SEO all read from here. Only `active` tools get a route; `coming-soon` tools are
 * listed as plans and cannot be opened; `hidden` tools are not listed at all.
 */
export type ToolStatus = 'active' | 'coming-soon' | 'hidden';

export interface ToolFaq {
  q: string;
  a: string;
}

export interface ToolDefinition {
  id: string;
  slug: string;
  title: string;
  summary: string;
  path: `/tools/${string}`;
  status: ToolStatus;
  tags: string[];
  /** What it can do today (only verified capabilities). */
  capabilities: string[];
  limitations: string[];
  exportFormats: string[];
  faq: ToolFaq[];
  seo: { title: string; description: string };
}

export const TOOLS: ToolDefinition[] = [
  {
    id: 'character-builder',
    slug: 'character-builder',
    title: 'Character Builder',
    summary: 'Turn a template, an existing skin or your reference photos into a 64×64 player skin or a spawnable custom Bedrock entity.',
    path: '/tools/character-builder',
    status: 'active',
    tags: ['skins', 'Java Edition', 'Bedrock Edition', 'add-ons', 'photos'],
    capabilities: [
      'Pixel-precise 64×64 skin editor with classic and slim arms, both layers, mirror painting and a live 3D preview',
      'Import existing skins (including legacy 64×32) and validate before download',
      'Photo-assisted starter skins: copies colours from guide boxes you place on your photos',
      'Cuboid entity editor with templates, per-face colours and painting',
      'Bedrock .mcaddon export with behavior + resource packs, validated before download',
    ],
    limitations: [
      'A skin cannot change the player body shape.',
      'Custom entities are static (no animations) in this version.',
      'AI generation runs only when the server has the required model and hardware; otherwise it is shown as unavailable.',
    ],
    exportFormats: ['PNG (64×64 player skin)', '.mcaddon (Bedrock behavior + resource pack)', '.geo.json + PNG (for inspection)'],
    faq: [
      {
        q: 'Does the skin work in Bedrock Edition?',
        a: 'The PNG uses the standard skin layout. Java Edition imports it through the launcher; whether and how Bedrock lets you import a custom skin depends on your device and platform.',
      },
      {
        q: 'Can I use the custom entity in Java Edition?',
        a: 'No. The .mcaddon is a Bedrock Edition add-on. Java Edition would need a separate mod, which this tool does not create.',
      },
      {
        q: 'Is it AI?',
        a: 'Every result is labelled. Manual and photo-assisted results are made by deterministic code you control. AI-generated is only shown when an AI model actually produced the result.',
      },
    ],
    seo: {
      title: 'Character Builder — Minecraft skin & Bedrock entity maker',
      description: 'Make a 64×64 Minecraft player skin or a spawnable Bedrock custom entity (.mcaddon) from templates or reference photos. Unofficial tool.',
    },
  },
  {
    id: 'pixel-art',
    slug: 'pixel-art',
    title: 'Pixel-art converter',
    summary: 'Planned: convert an image into a block palette.',
    path: '/tools/pixel-art',
    status: 'coming-soon',
    tags: ['planned'],
    capabilities: [],
    limitations: [],
    exportFormats: [],
    faq: [],
    seo: { title: 'Pixel-art converter (planned)', description: 'Planned tool.' },
  },
  {
    id: 'banner-designer',
    slug: 'banner-designer',
    title: 'Banner designer',
    summary: 'Planned: design banners and shields layer by layer.',
    path: '/tools/banner-designer',
    status: 'coming-soon',
    tags: ['planned'],
    capabilities: [],
    limitations: [],
    exportFormats: [],
    faq: [],
    seo: { title: 'Banner designer (planned)', description: 'Planned tool.' },
  },
];

export const listedTools = () => TOOLS.filter((t) => t.status !== 'hidden');
export const activeTools = () => TOOLS.filter((t) => t.status === 'active');
export const getTool = (id: string) => TOOLS.find((t) => t.id === id);

/** Static pages, for the sitemap. */
export const STATIC_PAGES = ['/', '/tools', '/about', '/privacy', '/terms'];
