import { Link } from 'react-router';
import { PageMeta } from '../../components/PageMeta';
import { LinkButton, Panel } from '../../components/ui';
import { storage } from '../../lib/storage';
import { getTool } from '../../tools/registry';
import { CapabilityList } from './components/CapabilityList';

export function StartPage() {
  const tool = getTool('character-builder')!;
  const skinId = storage.get('bw.skinProject');
  const entityId = storage.get('bw.entityProject');
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <PageMeta title={tool.seo.title} description={tool.seo.description} />
      <nav aria-label="Breadcrumb" className="mb-3 text-sm">
        <Link to="/tools">Tools</Link> <span className="text-muted">/ Character Builder</span>
      </nav>
      <h1 className="mb-2 text-3xl">Character Builder</h1>
      <p className="mb-8 max-w-3xl text-muted">{tool.summary}</p>

      <h2 className="mb-3 text-xl">What do you want to make?</h2>
      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <Panel className="flex flex-col p-5">
          <h3 className="mb-1 text-2xl text-gold">Player skin</h3>
          <p className="mb-1 text-sm text-ink">64×64 PNG for Minecraft Java Edition (manual import); Bedrock import varies by platform.</p>
          <p className="mb-4 text-sm text-muted">Recolours the standard player body (classic or slim arms). It cannot change the body shape.</p>
          <div className="mt-auto flex flex-wrap gap-2">
            <LinkButton to="skin?new=1" variant="primary">
              Make a skin
            </LinkButton>
            {skinId && <LinkButton to="skin">Continue last skin</LinkButton>}
          </div>
        </Panel>
        <Panel className="flex flex-col p-5">
          <h3 className="mb-1 text-2xl text-gold">Custom 3D entity</h3>
          <p className="mb-1 text-sm text-ink">Bedrock Edition add-on (.mcaddon) with your own cuboid model, spawnable with an egg or /summon.</p>
          <p className="mb-4 text-sm text-muted">Not a Java Edition mod and not a player skin.</p>
          <div className="mt-auto flex flex-wrap gap-2">
            <LinkButton to="entity?new=1" variant="primary">
              Build an entity
            </LinkButton>
            {entityId && <LinkButton to="entity">Continue last entity</LinkButton>}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="methods">
          <h2 id="methods" className="mb-3 text-xl">
            Methods available on this server
          </h2>
          <CapabilityList />
        </section>
        <section aria-labelledby="faq">
          <h2 id="faq" className="mb-3 text-xl">
            Good to know
          </h2>
          <dl className="space-y-3">
            {tool.faq.map((f) => (
              <div key={f.q} className="px-inset p-3">
                <dt className="font-pixel mb-1">{f.q}</dt>
                <dd className="text-sm text-muted">{f.a}</dd>
              </div>
            ))}
            {tool.limitations.map((l) => (
              <div key={l} className="px-inset p-3 text-sm text-muted">
                {l}
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
