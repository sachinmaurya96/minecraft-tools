import { useCallback, useEffect, useRef } from 'react';
import { ApiError } from '../../../lib/api';

export type SaveOutcome = 'saved' | 'offline' | 'conflict' | 'error';

/**
 * Debounced autosave. `save` must persist the editor state as of the moment it
 * starts and report success through the store. Network failures retry every
 * 10 s; a revision conflict stops autosave until the user resolves it.
 */
export function useAutosave({
  enabled,
  dirty,
  save,
  onState,
  delayMs = 1200,
}: {
  enabled: boolean;
  dirty: boolean;
  save: () => Promise<void>;
  onState: (state: 'saving' | SaveOutcome, message?: string) => void;
  delayMs?: number;
}) {
  const running = useRef<Promise<void> | null>(null);
  const blocked = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(async (): Promise<boolean> => {
    if (running.current) await running.current.catch(() => undefined);
    if (blocked.current) return false;
    onState('saving');
    const p = saveRef.current();
    running.current = p;
    try {
      await p;
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NETWORK') onState('offline', 'Offline: changes are kept in this browser and will be saved when the server is reachable.');
      else if (e instanceof ApiError && e.code === 'REVISION_CONFLICT') {
        blocked.current = true;
        onState('conflict', e.message);
      } else onState('error', e instanceof Error ? e.message : 'Save failed.');
      return false;
    } finally {
      running.current = null;
    }
  }, [onState]);

  useEffect(() => {
    if (!enabled || !dirty || blocked.current) return;
    const t = setTimeout(() => void flush(), delayMs);
    return () => clearTimeout(t);
  });

  // retry while offline
  useEffect(() => {
    if (!enabled || !dirty) return;
    const t = setInterval(() => {
      if (!running.current && !blocked.current) void flush();
    }, 10_000);
    return () => clearInterval(t);
  }, [enabled, dirty, flush]);

  return {
    /** Save now (e.g. before export). Resolves true when the server has the latest state. */
    flush,
    unblock: () => {
      blocked.current = false;
    },
  };
}
