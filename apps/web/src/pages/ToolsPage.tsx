import { PageMeta } from '../components/PageMeta';
import { LinkButton, Panel, StatusBadge } from '../components/ui';
import { listedTools } from '../tools/registry';

export function ToolsPage() {
  const tools = listedTools();
  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <PageMeta title="Tools" description="Blockwright tools for Minecraft creators. Only tools marked available can be used today." />
      <h1 className="mb-2 text-3xl">Tools</h1>
      <p className="mb-8 text-muted">
        Only tools marked “Available” work today. Planned tools are listed so you know what may come; they cannot be opened yet.
      </p>
      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => (
          <li key={t.id}>
            <Panel as="article" className="flex h-full flex-col p-5" aria-labelledby={`tool-${t.id}`}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <h2 id={`tool-${t.id}`} className="text-xl">
                  {t.title}
                </h2>
                {t.status === 'active' ? <StatusBadge tone="ok">Available</StatusBadge> : <StatusBadge tone="off">Planned</StatusBadge>}
              </div>
              <p className="mb-3 text-muted">{t.summary}</p>
              {t.status === 'active' && (
                <>
                  <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-muted">
                    {t.capabilities.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                  <p className="mb-4 text-sm">
                    <span className="text-muted">Exports: </span>
                    {t.exportFormats.join(' · ')}
                  </p>
                </>
              )}
              <div className="mt-auto">
                {t.status === 'active' ? (
                  <LinkButton to={t.path} variant="primary">
                    Open {t.title}
                  </LinkButton>
                ) : (
                  <p className="font-pixel text-sm text-muted">Not available yet</p>
                )}
              </div>
            </Panel>
          </li>
        ))}
      </ul>
    </div>
  );
}
