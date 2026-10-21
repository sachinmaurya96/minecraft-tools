import type {
  ApiEnvelope,
  ArtifactInfo,
  CapabilitiesResponse,
  EntityProject,
  EntityProjectState,
  ErrorCode,
  GenerationJob,
  ImageAsset,
  ImagePurpose,
  JobType,
  SkinProject,
  SkinProjectState,
  ValidationReport,
} from '@blockwright/shared';
import { storage } from './storage';

const BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
const SESSION_KEY = 'bw.session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
  }

  /** Validation report attached to EXPORT_INVALID / INVALID_SKIN errors, if any. */
  get report(): ValidationReport | undefined {
    const d = this.details as ValidationReport | undefined;
    return d && Array.isArray(d.issues) ? d : undefined;
  }
}

let sessionPromise: Promise<string> | null = null;

async function createSession(): Promise<string> {
  const res = await rawFetch('POST', '/v1/sessions');
  const token = (res as { token: string }).token;
  storage.set(SESSION_KEY, token);
  return token;
}

export function getSessionToken(): Promise<string> {
  const existing = storage.get(SESSION_KEY);
  if (existing) return Promise.resolve(existing);
  sessionPromise ??= createSession().finally(() => (sessionPromise = null));
  return sessionPromise;
}

export function forgetSession(): void {
  storage.remove(SESSION_KEY);
}

async function parse<T>(res: Response): Promise<T> {
  let body: ApiEnvelope<T> | null = null;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    /* non-JSON (proxy error etc.) */
  }
  if (!res.ok || !body || body.error) {
    const err = body?.error;
    throw new ApiError(
      res.status,
      err?.code ?? (res.status === 502 || res.status === 503 || res.status === 504 ? 'NETWORK' : 'INTERNAL'),
      err?.message ?? `The server returned HTTP ${res.status}.`,
      err?.details,
      body?.requestId,
    );
  }
  return body.data as T;
}

async function rawFetch<T>(method: string, path: string, init: { json?: unknown; form?: FormData; token?: string; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.token) headers['X-Session-Token'] = init.token;
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  } else if (init.form) {
    body = init.form;
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body, signal: init.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the Blockwright server. Check your connection; your edits are kept in this browser.');
  }
  return parse<T>(res);
}

/** Authenticated request; if the session token is unknown/expired, start a new session once. */
async function request<T>(method: string, path: string, init: { json?: unknown; form?: () => FormData; signal?: AbortSignal } = {}): Promise<T> {
  const attempt = async () => rawFetch<T>(method, path, { json: init.json, form: init.form?.(), token: await getSessionToken(), signal: init.signal });
  try {
    return await attempt();
  } catch (e) {
    if (e instanceof ApiError && e.code === 'UNAUTHORIZED') {
      forgetSession();
      return attempt();
    }
    throw e;
  }
}

async function requestBlob(path: string): Promise<{ blob: Blob; sha256: string | null }> {
  const doFetch = async () => fetch(`${BASE}${path}`, { headers: { 'X-Session-Token': await getSessionToken() } });
  let res: Response;
  try {
    res = await doFetch();
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the Blockwright server.');
  }
  if (!res.ok) await parse(res);
  return { blob: await res.blob(), sha256: res.headers.get('X-Artifact-Sha256') };
}

export type SkinProjectView = { project: SkinProject; skinPngBase64: string };
export type EntityProjectView = { project: EntityProject };
export type ProjectView = SkinProjectView | EntityProjectView;

export interface AddonExportResult {
  artifact: ArtifactInfo;
  raw: ArtifactInfo[];
  validation: ValidationReport;
  summary: Record<string, unknown> & { archiveTree: string[]; material: string; atlasMode: string; cubeCount?: number; textureSize?: [number, number] };
}

export const api = {
  capabilities: () => rawFetch<CapabilitiesResponse>('GET', '/v1/capabilities'),

  uploadImage: (file: File | Blob, purpose: ImagePurpose = 'reference', name = 'image') =>
    request<{ asset: ImageAsset }>('POST', '/v1/assets/images', {
      form: () => {
        const f = new FormData();
        f.set('purpose', purpose);
        f.set('file', file, file instanceof File ? file.name : name);
        return f;
      },
    }),
  getImageBlob: (id: string, variant: 'full' | 'thumb' = 'full') =>
    requestBlob(`/v1/assets/images/${encodeURIComponent(id)}/content?variant=${variant}`).then((r) => r.blob),
  deleteImage: (id: string) => request<{ deleted: true }>('DELETE', `/v1/assets/images/${encodeURIComponent(id)}`),
  uploadMesh: (file: File) =>
    request<{ mesh: { id: string; format: string; originalName: string; sizeBytes: number } }>('POST', '/v1/assets/meshes', {
      form: () => {
        const f = new FormData();
        f.set('file', file, file.name);
        return f;
      },
    }),

  createSkinProject: (state: SkinProjectState, skinPngBase64?: string, template?: { kind: 'template' | 'blank'; preset?: string }) =>
    request<SkinProjectView>('POST', '/v1/projects/skin', { json: { state, skinPngBase64, template } }),
  createEntityProject: (state: EntityProjectState) => request<EntityProjectView>('POST', '/v1/projects/entity', { json: { state } }),
  getProject: <V extends ProjectView = ProjectView>(id: string) => request<V>('GET', `/v1/projects/${encodeURIComponent(id)}`),
  updateProject: <V extends ProjectView = ProjectView>(
    id: string,
    baseRevision: number,
    state: SkinProjectState | EntityProjectState,
    skinPngBase64?: string,
    label?: string,
  ) => request<V>('PUT', `/v1/projects/${encodeURIComponent(id)}`, { json: { baseRevision, state, skinPngBase64, label } }),
  deleteProject: (id: string) => request<{ deleted: true }>('DELETE', `/v1/projects/${encodeURIComponent(id)}`),
  revisions: (id: string) =>
    request<{ revisions: Array<{ revision: number; at: string; label: string }> }>('GET', `/v1/projects/${encodeURIComponent(id)}/revisions`),
  revert: <V extends ProjectView = ProjectView>(id: string, baseRevision: number, toRevision: number) =>
    request<V>('POST', `/v1/projects/${encodeURIComponent(id)}/revert`, { json: { baseRevision, toRevision } }),
  applyResult: <V extends ProjectView = ProjectView>(id: string, baseRevision: number, artifactId: string) =>
    request<V>('POST', `/v1/projects/${encodeURIComponent(id)}/apply`, { json: { baseRevision, artifactId } }),

  exportSkin: (projectId: string, revision: number) =>
    request<{ artifact: ArtifactInfo; validation: ValidationReport }>('POST', '/v1/exports/skin', { json: { projectId, revision } }),
  exportAddon: (projectId: string, revision: number, includeRaw: boolean) =>
    request<AddonExportResult>('POST', '/v1/exports/bedrock-addon', { json: { projectId, revision, includeRaw } }),
  downloadArtifact: (id: string) => requestBlob(`/v1/artifacts/${encodeURIComponent(id)}/download`),

  createJob: (type: JobType, params: Record<string, unknown>) => request<{ job: GenerationJob }>('POST', `/v1/jobs/${type}`, { json: params }),
  getJob: (id: string) => request<{ job: GenerationJob }>('GET', `/v1/jobs/${encodeURIComponent(id)}`),
  cancelJob: (id: string) => request<{ job: GenerationJob }>('POST', `/v1/jobs/${encodeURIComponent(id)}/cancel`),

  deleteAllMyData: () => request<{ deleted: Record<string, number> }>('DELETE', '/v1/sessions/current'),
};

/** Save a Blob with a file name (anchor download; the token never appears in a URL). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
