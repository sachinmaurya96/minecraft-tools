import { createHash } from 'node:crypto';
import {
  encodeRgbaPng,
  ReportBuilder,
  type ArtifactInfo,
  type ArtifactKind,
  type EntityProjectState,
  type SkinProjectState,
  type ValidationReport,
} from '@blockwright/shared';
import { validateSkinPng } from '@blockwright/minecraft-skin';
import { AddonBuildError, buildAddon, validateAddonPacks, type AddonSummary } from '@blockwright/bedrock-export';
import type { Config } from '../config.js';
import { AppError, notFound } from '../http/errors.js';
import type { ProjectService } from '../services/projects.js';
import type { BaseRecord, FsStore } from '../storage/store.js';
import { readZip, zipFiles, ZipReadError } from './zip.js';

/** Server-side provenance carried by generated artifacts (never sent to clients as-is). */
export interface ArtifactProvenance {
  jobId?: string;
  origin?: 'ai' | 'import';
  providerId?: string;
  sourceMeshArtifactId?: string;
}

export interface ArtifactRecord extends BaseRecord, Omit<ArtifactInfo, 'id' | 'createdAt' | 'expiresAt'>, ArtifactProvenance {}

export function toArtifactInfo(r: ArtifactRecord): ArtifactInfo {
  const { ownerId: _o, updatedAt: _u, jobId: _j, origin: _g, providerId: _p, sourceMeshArtifactId: _s, ...rest } = r;
  return rest;
}

/** Download-safe ASCII file name. */
export function safeFileName(base: string, ext: string): string {
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 60);
  return `${cleaned || 'export'}.${ext}`;
}

export const ADDON_READ_LIMITS = { maxEntries: 64, maxTotalBytes: 64 * 1024 * 1024, maxEntryBytes: 16 * 1024 * 1024 };

export interface AddonExportResult {
  artifact: ArtifactInfo;
  raw: ArtifactInfo[];
  validation: ValidationReport;
  summary: AddonSummary & { material: string; atlasMode: string; archiveTree: string[] };
}

export class ExportService {
  constructor(
    private readonly config: Config,
    private readonly store: FsStore,
    private readonly projects: ProjectService,
  ) {}

  async saveArtifact(
    ownerId: string,
    input: {
      kind: ArtifactKind;
      filename: string;
      mime: string;
      bytes: Uint8Array;
      minecraftNative: boolean;
      label: string;
      projectId?: string;
      projectRevision?: number;
      extra?: ArtifactProvenance;
    },
  ): Promise<ArtifactRecord> {
    const id = this.store.newId('artifacts');
    const now = this.store.nowIso();
    const rec: ArtifactRecord = {
      id,
      ownerId,
      kind: input.kind,
      filename: input.filename,
      mime: input.mime,
      sizeBytes: input.bytes.length,
      sha256: createHash('sha256').update(input.bytes).digest('hex'),
      minecraftNative: input.minecraftNative,
      label: input.label,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.projectRevision !== undefined ? { projectRevision: input.projectRevision } : {}),
      ...(input.extra ?? {}),
      createdAt: now,
      updatedAt: now,
      expiresAt: this.store.expiryFromNow(this.config.ttlMs),
    };
    await this.store.putBlob('artifacts', id, 'file', input.bytes);
    await this.store.putRecord('artifacts', rec);
    return rec;
  }

  async getArtifact(ownerId: string, id: unknown): Promise<{ record: ArtifactRecord; bytes: Buffer }> {
    const record = await this.store.getOwned<ArtifactRecord>('artifacts', id, ownerId);
    if (!record) throw notFound('Download');
    const bytes = await this.store.getBlob('artifacts', record.id, 'file');
    if (!bytes) throw notFound('Download');
    if (createHash('sha256').update(bytes).digest('hex') !== record.sha256) {
      throw new AppError(500, 'EXPORT_INVALID', 'Stored export failed its integrity check; export it again.');
    }
    return { record, bytes };
  }

  async exportSkin(ownerId: string, projectId: unknown, revision: number): Promise<{ artifact: ArtifactInfo; validation: ValidationReport }> {
    const { record, state, png } = await this.projects.getRevision(ownerId, projectId, revision);
    if (record.type !== 'skin' || !png) throw new AppError(400, 'BAD_REQUEST', 'This project is not a skin project.');
    const s = state as SkinProjectState;
    const { report, image } = validateSkinPng(png, s.model);
    if (!report.ok || !image) {
      throw new AppError(422, 'EXPORT_INVALID', 'The skin did not pass validation, so no download was created.', report);
    }
    const bytes = encodeRgbaPng(image);
    // re-validate the exact bytes we are about to offer
    const final = validateSkinPng(bytes, s.model).report;
    if (!final.ok) throw new AppError(500, 'EXPORT_INVALID', 'Encoded skin failed validation.', final);
    const rec = await this.saveArtifact(ownerId, {
      kind: 'skin-png',
      filename: safeFileName(`${s.displayName}-${s.model}`, 'png'),
      mime: 'image/png',
      bytes,
      minecraftNative: true,
      label: `Player skin, 64x64 PNG (${s.model === 'slim' ? 'Slim, 3 px arms' : 'Classic, 4 px arms'})`,
      projectId: record.id,
      projectRevision: revision,
    });
    return { artifact: toArtifactInfo(rec), validation: final };
  }

  async exportAddon(ownerId: string, projectId: unknown, revision: number, includeRaw: boolean): Promise<AddonExportResult> {
    const { record, state } = await this.projects.getRevision(ownerId, projectId, revision);
    if (record.type !== 'entity') throw new AppError(400, 'BAD_REQUEST', 'This project is not an entity project.');
    const s = state as EntityProjectState;
    let addon;
    try {
      addon = buildAddon(s);
    } catch (err) {
      if (err instanceof AddonBuildError) {
        throw new AppError(422, err.code === 'MODEL_TOO_COMPLEX' ? 'MODEL_TOO_COMPLEX' : 'EXPORT_INVALID', err.message, err.details);
      }
      throw err;
    }
    // 1) validate the in-memory packs
    const pre = validateAddonPacks(addon.behaviorPack, addon.resourcePack);
    if (!pre.ok) throw new AppError(422, 'EXPORT_INVALID', 'The add-on did not pass validation, so no download was created.', pre);

    // 2) package: each pack as .mcpack, both inside .mcaddon
    const bpName = `${addon.fileBase}_BP.mcpack`;
    const rpName = `${addon.fileBase}_RP.mcpack`;
    const bpZip = await zipFiles(addon.behaviorPack);
    const rpZip = await zipFiles(addon.resourcePack);
    const mcaddon = await zipFiles(
      new Map([
        [bpName, bpZip],
        [rpName, rpZip],
      ]),
    );

    // 3) re-open the actual archive bytes and validate what a user would receive
    const report = new ReportBuilder();
    report.check('mcaddon-zip-readable');
    let tree: string[] = [];
    try {
      const outer = await readZip(mcaddon, ADDON_READ_LIMITS);
      tree = [...outer.keys()];
      report.check('mcaddon-contains-two-mcpacks');
      if (tree.length !== 2 || !outer.has(bpName) || !outer.has(rpName)) {
        report.error('ARCHIVE_TREE', `Expected exactly ${bpName} and ${rpName}, found: ${tree.join(', ')}`);
      } else {
        const bp = await readZip(Buffer.from(outer.get(bpName)!), ADDON_READ_LIMITS);
        const rp = await readZip(Buffer.from(outer.get(rpName)!), ADDON_READ_LIMITS);
        tree = [...[...bp.keys()].map((k) => `${bpName}/${k}`), ...[...rp.keys()].map((k) => `${rpName}/${k}`)];
        report.check('archive-content-matches-build');
        for (const [label, built, read] of [
          ['BP', addon.behaviorPack, bp],
          ['RP', addon.resourcePack, rp],
        ] as const) {
          if (built.size !== read.size) report.error('ARCHIVE_CONTENT', `${label} has ${read.size} files, expected ${built.size}`);
          for (const [name, bytes] of built) {
            const got = read.get(name);
            if (!got || Buffer.compare(Buffer.from(got), Buffer.from(bytes)) !== 0) report.error('ARCHIVE_CONTENT', `${label} ${name} differs after packaging`);
          }
        }
        report.merge(validateAddonPacks(bp, rp));
      }
    } catch (err) {
      if (err instanceof ZipReadError) report.error('ARCHIVE_UNREADABLE', err.message);
      else throw err;
    }
    const validation = report.build();
    if (!validation.ok) throw new AppError(500, 'EXPORT_INVALID', 'Packaged add-on failed verification; no download was created.', validation);

    const artifact = await this.saveArtifact(ownerId, {
      kind: 'mcaddon',
      filename: `${addon.fileBase}.mcaddon`,
      mime: 'application/zip',
      bytes: mcaddon,
      minecraftNative: true,
      label: 'Bedrock add-on (.mcaddon: behavior + resource pack)',
      projectId: record.id,
      projectRevision: revision,
    });
    const raw: ArtifactInfo[] = [];
    if (includeRaw) {
      const geoPath = [...addon.resourcePack.keys()].find((k) => k.endsWith('.geo.json'))!;
      raw.push(
        toArtifactInfo(
          await this.saveArtifact(ownerId, {
            kind: 'geo-json',
            filename: `${addon.fileBase}.geo.json`,
            mime: 'application/json',
            bytes: addon.resourcePack.get(geoPath)!,
            minecraftNative: true,
            label: 'Raw Bedrock geometry for inspection (e.g. Blockbench); not installable on its own',
            projectId: record.id,
            projectRevision: revision,
          }),
        ),
        toArtifactInfo(
          await this.saveArtifact(ownerId, {
            kind: 'entity-texture',
            filename: `${addon.fileBase}.png`,
            mime: 'image/png',
            bytes: encodeRgbaPng(addon.atlas.image),
            minecraftNative: true,
            label: 'Entity texture atlas (PNG)',
            projectId: record.id,
            projectRevision: revision,
          }),
        ),
      );
    }
    return {
      artifact: toArtifactInfo(artifact),
      raw,
      validation,
      summary: { ...pre.summary, material: addon.material, atlasMode: addon.atlas.mode, archiveTree: tree },
    };
  }
}
