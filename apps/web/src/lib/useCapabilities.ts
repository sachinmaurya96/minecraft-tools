import { useQuery } from '@tanstack/react-query';
import type { ProviderCapabilities } from '@blockwright/shared';
import { api } from './api';

/** Server-reported runtime readiness of every generation provider (refreshed every 30 s). */
export function useCapabilities() {
  return useQuery({ queryKey: ['capabilities'], queryFn: api.capabilities, staleTime: 15_000, refetchInterval: 30_000 });
}

export function useProvider(id: string): { provider: ProviderCapabilities | undefined; loading: boolean; error: unknown } {
  const q = useCapabilities();
  return { provider: q.data?.providers.find((p) => p.id === id), loading: q.isLoading, error: q.error };
}
