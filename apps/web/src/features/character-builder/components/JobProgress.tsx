import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { TERMINAL_JOB_STATUSES, type GenerationJob } from '@blockwright/shared';
import { Button, Callout, Spinner } from '../../../components/ui';
import { api } from '../../../lib/api';

/**
 * Polls a generation job. Shows the real stage reported by the server and the
 * real time since it started — never an invented percentage or fake timer.
 */
export function useJob(jobId: string | null) {
  return useQuery({
    queryKey: ['job', jobId],
    queryFn: async () => (await api.getJob(jobId!)).job,
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data && TERMINAL_JOB_STATUSES.includes(q.state.data.status) ? false : 1000),
  });
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span>{Math.max(0, Math.round((now - Date.parse(since)) / 1000))} s</span>;
}

export function JobProgress({ job, onCancel }: { job: GenerationJob; onCancel?: () => void }) {
  if (job.status === 'failed') {
    return (
      <Callout tone="error" title="Generation failed">
        <p>{job.errorMessage ?? 'The job failed.'}</p>
        <p className="mt-1 text-xs">Code {job.errorCode ?? 'JOB_FAILED'}. Nothing in your project was changed.</p>
      </Callout>
    );
  }
  if (job.status === 'cancelled') return <Callout tone="warn">Cancelled. Nothing in your project was changed.</Callout>;
  if (job.status === 'ready') return <Callout tone="ok">Finished.</Callout>;
  return (
    <div className="px-inset flex flex-wrap items-center justify-between gap-2 p-3" aria-live="polite">
      <Spinner label={`${job.status === 'queued' ? 'Queued' : 'Working'}: ${job.progressStage}`} />
      <span className="text-sm text-muted">{job.startedAt ? <Elapsed since={job.startedAt} /> : 'waiting for a free worker'}</span>
      {onCancel && (
        <Button size="sm" variant="danger" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}
