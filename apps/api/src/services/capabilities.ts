import { LIMITS, type CapabilitiesResponse, type ProviderCapabilities } from '@blockwright/shared';
import type { Config } from '../config.js';
import type { WorkerCapabilities, WorkerClient } from './workerClient.js';

type StaticProvider = Omit<ProviderCapabilities, 'available' | 'status' | 'reason'>;

/** Providers implemented in the browser + API. Always available: no worker or GPU involved. */
const LOCAL_PROVIDERS: StaticProvider[] = [
  {
    id: 'manual-skin',
    label: 'Template, blank or imported skin + pixel editor',
    kind: 'skin',
    mode: 'manual',
    requiresGpu: false,
    requiresWorker: false,
    acceptedImageRoles: [],
    acceptedInputFormat: 'None, or an existing 64x64 (or legacy 64x32) PNG skin',
    outputFormat: '64x64 RGBA PNG (standard Java skin atlas)',
    limitations: ['A skin cannot change the player body shape.'],
  },
  {
    id: 'photo-projection-v1',
    label: 'Photo-assisted starter skin',
    kind: 'skin',
    mode: 'photo-assisted',
    requiresGpu: false,
    requiresWorker: false,
    acceptedImageRoles: ['front', 'back', 'left', 'right'],
    acceptedInputFormat: 'PNG/JPEG/WebP reference photos; a front view is required',
    outputFormat: '64x64 RGBA PNG',
    limitations: [
      'Copies colours inside guide boxes you place; it does not recognise faces, hair or clothing.',
      'Sides, tops, bottoms and views you did not upload are interpolated and labelled approximate.',
      'Works best with a plain background and a full-body front view.',
    ],
  },
  {
    id: 'manual-entity',
    label: 'Cuboid entity editor (templates, import from skin or Blockbench model)',
    kind: 'entity',
    mode: 'manual',
    requiresGpu: false,
    requiresWorker: false,
    acceptedImageRoles: [],
    acceptedInputFormat: 'None, a 64x64 skin PNG, or a Bedrock .geo.json + texture PNG',
    outputFormat: 'Bedrock .mcaddon (behavior + resource pack)',
    limitations: ['Static, unanimated entity in v1.', 'Only cuboids (no arbitrary meshes).'],
  },
  {
    id: 'photo-palette-entity-v1',
    label: 'Photo-assisted entity colours',
    kind: 'entity',
    mode: 'photo-assisted',
    requiresGpu: false,
    requiresWorker: false,
    acceptedImageRoles: ['front', 'back', 'left', 'right'],
    acceptedInputFormat: 'PNG/JPEG/WebP reference photos',
    outputFormat: 'Colours / face textures applied to your cuboid model',
    limitations: ['Samples colours and face images; it does not reconstruct 3D shape from photos.'],
  },
];

/** Providers executed by the Python worker. Availability comes from the worker's own self-checks. */
const WORKER_PROVIDERS: Array<StaticProvider & { flag?: 'ENABLE_SKING' | 'ENABLE_TRIPOSR' }> = [
  {
    id: 'sking-v101c',
    flag: 'ENABLE_SKING',
    label: 'AI skin (Sking SKING_DDJ_v101c)',
    kind: 'skin',
    mode: 'ai',
    requiresGpu: true,
    requiresWorker: true,
    acceptedImageRoles: ['front', 'back'],
    acceptedInputFormat: 'One square, even-size PNG (256-4096 px): front_left view on the left, back_left view on the right',
    outputFormat: '64x64 RGBA PNG (base + outer layer)',
    license: 'AGPL-3.0',
    limitations: [
      'Requires Linux and an NVIDIA CUDA GPU.',
      'Uses a reviewed two-view composite, not raw photos; side photos are not used by the model.',
      'Semantic errors can occur; the result opens in the editor for correction.',
    ],
  },
  {
    id: 'triposr',
    flag: 'ENABLE_TRIPOSR',
    label: 'AI 3D mesh (TripoSR) -> cuboids',
    kind: 'entity',
    mode: 'ai',
    requiresGpu: false,
    requiresWorker: true,
    acceptedImageRoles: ['front'],
    acceptedInputFormat: 'One primary image (only one view is used by the model)',
    outputFormat: 'Generic mesh (.glb, not Minecraft-native) converted to native Bedrock cuboids',
    license: 'MIT',
    limitations: [
      'Single-image reconstruction: hidden sides are guessed by the model.',
      'Mesh detail is lost when converting to cuboids; the result is a static one-bone model.',
      'Slow without a CUDA GPU.',
    ],
  },
  {
    id: 'mesh-cuboids-v1',
    label: 'Mesh -> cuboid converter',
    kind: 'entity',
    mode: 'manual',
    requiresGpu: false,
    requiresWorker: true,
    acceptedImageRoles: [],
    acceptedInputFormat: '.glb or .obj triangle mesh (bounded size and triangle count)',
    outputFormat: 'Native Bedrock cuboid model (static, one bone)',
    limitations: ['Voxelizes the mesh: thin parts and fine detail are lost.', 'Colours come from vertex colours or a texture if present.'],
  },
];

export class CapabilitiesService {
  private cache: { at: number; value: CapabilitiesResponse } | null = null;

  constructor(
    private readonly config: Config,
    private readonly worker: WorkerClient,
    private readonly cacheMs = 10_000,
  ) {}

  invalidate(): void {
    this.cache = null;
  }

  async get(): Promise<CapabilitiesResponse> {
    if (this.cache && Date.now() - this.cache.at < this.cacheMs) return this.cache.value;
    let workerCaps: WorkerCapabilities | null = null;
    let workerError: string | undefined;
    try {
      workerCaps = await this.worker.capabilities();
    } catch (err) {
      workerError = (err as Error).message;
    }
    const providers: ProviderCapabilities[] = [
      ...LOCAL_PROVIDERS.map((p) => ({ ...p, available: true, status: 'ready' as const })),
      ...WORKER_PROVIDERS.map(({ flag, ...p }): ProviderCapabilities => {
        if (flag && !this.config[flag]) {
          return { ...p, available: false, status: 'disabled', reason: `Disabled by server configuration (${flag}=false).` };
        }
        if (!workerCaps) {
          return { ...p, available: false, status: 'unavailable', reason: `The AI/geometry worker is not reachable: ${workerError}` };
        }
        const s = workerCaps.providers[p.id];
        if (!s) return { ...p, available: false, status: 'unavailable', reason: 'The worker does not provide this feature.' };
        return { ...p, available: s.status === 'ready', status: s.status, ...(s.reason ? { reason: s.reason } : {}) };
      }),
    ];
    const value: CapabilitiesResponse = {
      providers,
      worker: {
        reachable: !!workerCaps,
        checkedAt: new Date().toISOString(),
        ...(workerError ? { error: workerError } : {}),
        ...(workerCaps?.device ? { device: workerCaps.device } : {}),
      },
      retentionHours: this.config.PROJECT_TTL_HOURS,
      limits: {
        maxImageMb: this.config.MAX_IMAGE_MB,
        maxImagePixels: this.config.MAX_IMAGE_PIXELS,
        maxImagesPerProject: this.config.MAX_IMAGES_PER_PROJECT,
        maxCubes: LIMITS.maxCubes,
        maxAtlasSize: LIMITS.maxAtlasSize,
      },
    };
    this.cache = { at: Date.now(), value };
    return value;
  }

  async isReady(providerId: string): Promise<ProviderCapabilities | undefined> {
    return (await this.get()).providers.find((p) => p.id === providerId);
  }
}
