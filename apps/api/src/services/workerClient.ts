/**
 * Client for the internal Python worker. Authenticated with a shared bearer
 * token that never reaches the browser. Every call has a bounded timeout.
 */

export interface WorkerProviderStatus {
  status: 'ready' | 'disabled' | 'unavailable' | 'error';
  reason?: string;
  details?: Record<string, unknown>;
}

export interface WorkerCapabilities {
  device: string;
  providers: Record<string, WorkerProviderStatus>;
}

export interface WorkerJob {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'ready' | 'failed' | 'cancelled';
  stage: string;
  error_code?: string | null;
  error_message?: string | null;
  artifacts: string[];
  result?: Record<string, unknown> | null;
}

export interface WorkerFile {
  field: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export class WorkerError extends Error {
  constructor(
    message: string,
    readonly kind: 'unreachable' | 'unauthorized' | 'http' | 'not_configured',
    readonly status?: number,
  ) {
    super(message);
  }
}

export class WorkerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 5000,
  ) {}

  get configured(): boolean {
    return this.token.length > 0;
  }

  private async request(pathname: string, init: RequestInit = {}, timeoutMs = this.timeoutMs): Promise<Response> {
    if (!this.configured) throw new WorkerError('AI_WORKER_TOKEN is not set on the API', 'not_configured');
    let res: Response;
    try {
      res = await fetch(new URL(pathname, this.baseUrl), {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch (err) {
      throw new WorkerError(`AI worker is not reachable (${(err as Error).name})`, 'unreachable');
    }
    if (res.status === 401 || res.status === 403) throw new WorkerError('AI worker rejected the API token', 'unauthorized', res.status);
    if (!res.ok) {
      let detail = '';
      try {
        detail = JSON.stringify(await res.json());
      } catch {
        /* ignore */
      }
      throw new WorkerError(`AI worker returned HTTP ${res.status} ${detail}`.trim(), 'http', res.status);
    }
    return res;
  }

  async health(): Promise<{ status: string; version?: string }> {
    // /health is unauthenticated on the worker; still go through request() for timeouts
    return (await (await this.request('/health')).json()) as { status: string; version?: string };
  }

  async capabilities(): Promise<WorkerCapabilities> {
    return (await (await this.request('/v1/capabilities')).json()) as WorkerCapabilities;
  }

  async submitJob(type: string, params: Record<string, unknown>, files: WorkerFile[]): Promise<WorkerJob> {
    const form = new FormData();
    form.set('type', type);
    form.set('params', JSON.stringify(params));
    for (const f of files) form.append(f.field, new Blob([f.bytes as Uint8Array<ArrayBuffer>], { type: f.contentType }), f.filename);
    return (await (await this.request('/v1/jobs', { method: 'POST', body: form }, 60_000)).json()) as WorkerJob;
  }

  async getJob(id: string): Promise<WorkerJob> {
    return (await (await this.request(`/v1/jobs/${encodeURIComponent(id)}`)).json()) as WorkerJob;
  }

  async cancelJob(id: string): Promise<void> {
    await this.request(`/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  }

  async downloadArtifact(id: string, name: string, maxBytes: number): Promise<Uint8Array> {
    const res = await this.request(`/v1/jobs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(name)}`, {}, 120_000);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > maxBytes) throw new WorkerError(`Worker artifact ${name} is too large (${len} bytes)`, 'http');
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new WorkerError(`Worker artifact ${name} is too large`, 'http');
    return buf;
  }
}
