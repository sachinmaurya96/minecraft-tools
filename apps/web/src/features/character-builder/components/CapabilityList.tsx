import type { GenerationKind, ProviderCapabilities } from '@blockwright/shared';
import { Callout, Spinner, StatusBadge } from '../../../components/ui';
import { useCapabilities } from '../../../lib/useCapabilities';

const MODE_LABEL = { manual: 'Manual', 'photo-assisted': 'Photo-assisted', ai: 'AI' } as const;

export function ProviderStatusBadge({ p }: { p: ProviderCapabilities }) {
  if (p.available) return <StatusBadge tone="ok">Ready</StatusBadge>;
  if (p.status === 'disabled') return <StatusBadge tone="off">Disabled</StatusBadge>;
  if (p.status === 'error') return <StatusBadge tone="error">Error</StatusBadge>;
  return <StatusBadge tone="warn">Unavailable</StatusBadge>;
}

/** Truthful list of generation methods for one output kind, straight from /capabilities. */
export function CapabilityList({ kind }: { kind?: GenerationKind }) {
  const { data, isLoading, error } = useCapabilities();
  if (isLoading) return <Spinner label="Checking which methods are available" />;
  if (error || !data)
    return (
      <Callout tone="warn" title="Server not reachable">
        Manual editing still works in your browser; saving, exporting and AI features need the server.
      </Callout>
    );
  const providers = data.providers.filter((p) => !kind || p.kind === kind);
  return (
    <ul className="space-y-2" aria-label="Generation methods">
      {providers.map((p) => (
        <li key={p.id} className="px-inset p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-pixel">
              {p.label} <span className="text-sm text-muted">· {MODE_LABEL[p.mode]}</span>
            </span>
            <ProviderStatusBadge p={p} />
          </div>
          {!p.available && p.reason && <p className="mt-1 text-sm text-muted">{p.reason}</p>}
        </li>
      ))}
    </ul>
  );
}
