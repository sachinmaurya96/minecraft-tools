import { useState } from 'react';
import { decodePngToRgba, type EntityProjectState, type Provenance, type RgbaImage } from '@blockwright/shared';
import { convertLegacySkin, suggestModel } from '@blockwright/minecraft-skin';
import { ENTITY_TEMPLATES, importGeometry, skinToHumanoid, type GeoFile } from '@blockwright/bedrock-export';
import { Button, Panel } from '../../../components/ui';
import { useProvider } from '../../../lib/useCapabilities';
import { ProviderStatusBadge } from '../components/CapabilityList';

export interface EntityStart {
  model: Pick<EntityProjectState, 'bones' | 'cubes'>;
  templateId: string;
  displayName: string;
  slug: string;
  provenance: Provenance;
  spawnEgg?: EntityProjectState['spawnEgg'];
  suggestedIdentifier?: string;
  /** Open this tool right after the project is created. */
  then?: 'mesh' | 'ai' | 'photo';
}

const prov = (origin: Provenance['origin'], notes: string[] = []): Provenance => ({ origin, editedAfterGeneration: false, inferredRegions: [], notes });

export function NewEntityBody({ onStart }: { onStart: (s: EntityStart) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [geoFile, setGeoFile] = useState<File | null>(null);
  const [texFile, setTexFile] = useState<File | null>(null);
  const meshProvider = useProvider('mesh-cuboids-v1');
  const triposr = useProvider('triposr');
  const block = ENTITY_TEMPLATES.find((t) => t.id === 'block')!;

  async function fromSkin(file: File | undefined) {
    setError(null);
    if (!file) return;
    try {
      let { image } = decodePngToRgba(new Uint8Array(await file.arrayBuffer()));
      if (image.width === 64 && image.height === 32) image = convertLegacySkin(image).image;
      if (image.width !== 64 || image.height !== 64) throw new Error('Use a 64×64 (or legacy 64×32) skin PNG.');
      const model = skinToHumanoid(image, suggestModel(image));
      onStart({
        model,
        templateId: 'humanoid',
        displayName: 'Skin figure',
        slug: 'skin_figure',
        provenance: prov('import', ['Built from a player skin with the standard box-UV layout.']),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function fromGeometry() {
    setError(null);
    try {
      if (!geoFile) throw new Error('Choose a .geo.json file.');
      if (geoFile.size > 4 * 1024 * 1024) throw new Error('That geometry file is too large.');
      const geo = JSON.parse(await geoFile.text()) as GeoFile;
      let texture: RgbaImage | null = null;
      if (texFile) texture = decodePngToRgba(new Uint8Array(await texFile.arrayBuffer())).image;
      const imported = importGeometry(geo, texture);
      onStart({
        model: { bones: imported.bones, cubes: imported.cubes },
        templateId: 'import',
        displayName: geoFile.name.replace(/\.geo\.json$|\.json$/i, '').slice(0, 40) || 'Imported model',
        slug: 'imported_model',
        provenance: prov('import', [`Imported from ${geoFile.name}${texFile ? ` with ${texFile.name}` : ' (no texture: grey)'}.`, ...imported.warnings]),
        ...(imported.suggestedIdentifier ? { suggestedIdentifier: imported.suggestedIdentifier } : {}),
      });
    } catch (e) {
      setError(`Import failed: ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl">Start from a template</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {ENTITY_TEMPLATES.map((t) => (
          <Panel key={t.id} className="flex flex-col p-4">
            <h3 className="mb-1 text-lg">{t.name}</h3>
            <p className="mb-3 text-sm text-muted">{t.description}</p>
            <Button
              className="mt-auto"
              variant="primary"
              onClick={() => {
                const m = t.build();
                onStart({
                  model: { bones: m.bones, cubes: m.cubes },
                  spawnEgg: m.spawnEgg,
                  templateId: t.id,
                  displayName: t.name,
                  slug: t.id === 'humanoid' ? 'blocky_buddy' : t.id === 'quadruped' ? 'critter' : 'living_block',
                  provenance: prov('template'),
                });
              }}
            >
              Use {t.name.toLowerCase()}
            </Button>
          </Panel>
        ))}
      </div>

      <h2 className="text-xl">Or bring something</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel className="p-4">
          <h3 className="mb-1 text-lg">From your photos (humanoid)</h3>
          <p className="mb-2 text-sm text-muted">Copies colours from guide boxes on your photos onto a player-proportioned figure. Photo-assisted, no AI.</p>
          <Button
            variant="primary"
            onClick={() => {
              const m = ENTITY_TEMPLATES[0]!.build();
              onStart({
                model: { bones: m.bones, cubes: m.cubes },
                templateId: 'humanoid',
                displayName: 'Photo figure',
                slug: 'photo_figure',
                provenance: prov('template'),
                then: 'photo',
              });
            }}
          >
            Use my photos
          </Button>
        </Panel>
        <Panel className="p-4">
          <h3 className="mb-1 text-lg">From a player skin</h3>
          <p className="mb-2 text-sm text-muted">Turns a 64×64 skin into a humanoid entity, including its outer layer.</p>
          <input type="file" accept="image/png" aria-label="Skin PNG" className="text-sm" onChange={(e) => fromSkin(e.target.files?.[0])} />
        </Panel>
        <Panel className="p-4">
          <h3 className="mb-1 text-lg">Bedrock / Blockbench model</h3>
          <p className="mb-2 text-sm text-muted">A .geo.json (format 1.12+) and its texture PNG, e.g. exported from Blockbench.</p>
          <label className="mb-1 block text-xs text-muted">
            Geometry (.geo.json)
            <input type="file" accept=".json,application/json" className="block text-sm" onChange={(e) => setGeoFile(e.target.files?.[0] ?? null)} />
          </label>
          <label className="mb-2 block text-xs text-muted">
            Texture (.png, optional)
            <input type="file" accept="image/png" className="block text-sm" onChange={(e) => setTexFile(e.target.files?.[0] ?? null)} />
          </label>
          <Button onClick={fromGeometry} disabled={!geoFile}>
            Import model
          </Button>
        </Panel>
        <Panel className="p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="text-lg">3D mesh → cuboids</h3>
            {meshProvider.provider && <ProviderStatusBadge p={meshProvider.provider} />}
          </div>
          <p className="mb-2 text-sm text-muted">Convert a .glb/.obj mesh into Minecraft cuboids (voxelized; detail is lost).</p>
          <Button
            disabled={!meshProvider.provider?.available}
            onClick={() =>
              onStart({ model: block.build(), templateId: 'block', displayName: 'Mesh model', slug: 'mesh_model', provenance: prov('template'), then: 'mesh' })
            }
          >
            Convert a mesh
          </Button>
          {meshProvider.provider && !meshProvider.provider.available && <p className="mt-1 text-xs text-gold">{meshProvider.provider.reason}</p>}
        </Panel>
        <Panel className="p-4 md:col-span-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="text-lg">AI 3D from a photo (TripoSR)</h3>
            {triposr.provider && <ProviderStatusBadge p={triposr.provider} />}
          </div>
          <p className="mb-2 text-sm text-muted">
            One photo → a generic AI mesh → converted to cuboids. Only one view is used; hidden sides are guessed. Label: AI-generated.
          </p>
          {triposr.provider && !triposr.provider.available && <p className="mb-2 text-xs text-gold">{triposr.provider.reason}</p>}
          <Button
            disabled={!triposr.provider?.available}
            onClick={() =>
              onStart({ model: block.build(), templateId: 'block', displayName: 'AI model', slug: 'ai_model', provenance: prov('template'), then: 'ai' })
            }
          >
            Continue with AI
          </Button>
        </Panel>
      </div>
      {error && (
        <p role="alert" className="text-sm text-redstone">
          {error}
        </p>
      )}
    </div>
  );
}
