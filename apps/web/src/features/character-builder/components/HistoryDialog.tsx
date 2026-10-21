import { useQuery } from '@tanstack/react-query';
import { Button, Callout, Dialog, Spinner } from '../../../components/ui';
import { api } from '../../../lib/api';

/** Server-side revision history with restore (restoring creates a new revision; nothing is lost). */
export function HistoryDialog({
  projectId,
  currentRevision,
  open,
  onClose,
  onRestore,
}: {
  projectId: string;
  currentRevision: number;
  open: boolean;
  onClose: () => void;
  onRestore: (revision: number) => void;
}) {
  const q = useQuery({ queryKey: ['revisions', projectId, currentRevision], queryFn: () => api.revisions(projectId), enabled: open });
  return (
    <Dialog open={open} onClose={onClose} title="Revision history">
      {q.isLoading && <Spinner label="Loading history" />}
      {q.error && <Callout tone="error">{(q.error as Error).message}</Callout>}
      {q.data && (
        <ol className="max-h-96 space-y-1 overflow-auto">
          {[...q.data.revisions].reverse().map((r) => (
            <li key={r.revision} className="px-inset flex items-center justify-between gap-2 p-2 text-sm">
              <span>
                <span className="font-pixel">Rev {r.revision}</span> · {r.label} · <time dateTime={r.at}>{new Date(r.at).toLocaleString()}</time>
              </span>
              {r.revision === currentRevision ? (
                <span className="text-xs text-muted">current</span>
              ) : (
                <Button size="sm" onClick={() => onRestore(r.revision)}>
                  Restore
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-xs text-muted">Restoring copies an older revision into a new one, so you can always go back again.</p>
    </Dialog>
  );
}
