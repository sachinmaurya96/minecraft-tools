import { PageMeta } from '../components/PageMeta';
import { LinkButton, Panel, ProvenanceBadge } from '../components/ui';

export function HomePage() {
  return (
    <>
      <PageMeta
        title="Blockwright — tools for Minecraft creators"
        description="Independent tools for Minecraft creators. Build a 64×64 player skin or a spawnable Bedrock custom entity from templates or reference photos."
      />
      <section className="border-b-2 border-shadow bg-night-2">
        <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-12 md:grid-cols-[1.3fr_1fr] md:py-16">
          <div>
            <p className="font-pixel mb-3 text-gold">Character Builder · first Blockwright tool</p>
            <h1 className="mb-4 text-4xl leading-tight sm:text-5xl">Make your character Minecraft-ready.</h1>
            <p className="mb-6 max-w-2xl text-lg text-muted">
              Turn a template, an existing skin or your own reference photos into a <strong className="text-ink">64×64 player skin</strong> or a{' '}
              <strong className="text-ink">spawnable Bedrock custom entity</strong>. Every result says honestly how it was made.
            </p>
            <div className="flex flex-wrap gap-3">
              <LinkButton to="/tools/character-builder" variant="primary">
                Open Character Builder
              </LinkButton>
              <LinkButton to="/tools">Browse tools</LinkButton>
            </div>
          </div>
          <div aria-hidden className="mx-auto grid grid-cols-8 gap-0 border-2 border-shadow" style={{ width: 'min(70vw, 280px)' }}>
            {/* decorative original pixel character */}
            {HERO_PIXELS.map((c, i) => (
              <span key={i} style={{ background: c, aspectRatio: '1' }} />
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-10">
        <h2 className="mb-4 text-2xl">Two outputs, clearly separated</h2>
        <div className="mb-10 grid gap-4 md:grid-cols-2">
          <Panel className="p-5">
            <h3 className="mb-2 text-xl text-gold">Player skin (PNG)</h3>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              <li>Standard 64×64 RGBA skin, classic (4 px) or slim (3 px) arms, inner and outer layer.</li>
              <li>Import it in Minecraft Java Edition through the launcher. Bedrock skin import depends on your device.</li>
              <li>It recolours the normal player body. It cannot add wings, tails or a different shape.</li>
            </ul>
          </Panel>
          <Panel className="p-5">
            <h3 className="mb-2 text-xl text-gold">Custom 3D entity (.mcaddon)</h3>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              <li>Your own cuboid model with texture, packaged as a Bedrock Edition add-on (behavior + resource pack).</li>
              <li>Activate both packs on a world, then spawn it with its spawn egg or <code>/summon</code>.</li>
              <li>Not a Java Edition mod and not a player skin.</li>
            </ul>
          </Panel>
        </div>

        <h2 className="mb-4 text-2xl">How it works</h2>
        <ol className="mb-10 grid gap-4 md:grid-cols-4">
          {[
            ['Choose an output', 'Player skin or custom entity.'],
            ['Add references (optional)', 'Front, back and side photos. Skip this and start from a template.'],
            ['Edit', 'Paint pixels, move and resize cubes, check the live 3D preview.'],
            ['Export', 'Downloads are validated on the server before you get them.'],
          ].map(([title, text], i) => (
            <li key={title} className="px-panel p-4">
              <p className="font-pixel mb-1 text-3xl text-grass">{i + 1}</p>
              <p className="font-pixel mb-1">{title}</p>
              <p className="text-sm text-muted">{text}</p>
            </li>
          ))}
        </ol>

        <h2 className="mb-4 text-2xl">Honest labels</h2>
        <Panel className="mb-6 p-5">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="mb-1">
                <ProvenanceBadge label="Manual" />
              </dt>
              <dd className="text-sm text-muted">Made from a template, a blank canvas, an imported file or your own edits.</dd>
            </div>
            <div>
              <dt className="mb-1">
                <ProvenanceBadge label="Photo-assisted" />
              </dt>
              <dd className="text-sm text-muted">Colours copied from your photos by simple, predictable code. Areas it had to guess are marked approximate.</dd>
            </div>
            <div>
              <dt className="mb-1">
                <ProvenanceBadge label="AI-generated" />
              </dt>
              <dd className="text-sm text-muted">Only when an AI model actually ran on the server. If the hardware is not there, the option is shown as unavailable.</dd>
            </div>
            <div>
              <dt className="mb-1">
                <ProvenanceBadge label="Demo sample" />
              </dt>
              <dd className="text-sm text-muted">A built-in example you chose to load. Never presented as your result.</dd>
            </div>
          </dl>
        </Panel>
      </div>
    </>
  );
}

// 8x8 original decorative sprite (same design as the original template, not a Minecraft texture)
const H = '#3b2a4a';
const S = '#d8a483';
const E = '#1d1d24';
const C = '#c98877';
const M = '#97735c';
const HERO_PIXELS = [
  H, H, H, H, H, H, H, H,
  H, H, H, H, H, H, S, S,
  H, H, H, S, S, S, S, S,
  S, S, E, S, S, E, S, S,
  S, S, E, S, S, E, S, S,
  S, C, S, S, S, S, C, S,
  S, S, S, M, M, S, S, S,
  S, S, S, S, S, S, S, S,
];
