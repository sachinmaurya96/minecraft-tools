import { useState } from 'react';
import { decodePngToRgba, type RgbaImage, type SkinModel } from '@blockwright/shared';
import { convertLegacySkin, createBlankSkin, createTemplateSkin, createUvDebugSkin, suggestModel, TEMPLATE_PRESETS, validateSkinImage } from '@blockwright/minecraft-skin';
import { Button, Callout, Panel } from '../../../components/ui';
import { useProvider } from '../../../lib/useCapabilities';
import { ProviderStatusBadge } from '../components/CapabilityList';

export type SkinStart =
  | { kind: 'template' | 'blank' | 'sample' | 'photo' | 'ai'; model: SkinModel; pixels: Uint8ClampedArray; name: string }
  | { kind: 'import'; model: SkinModel; pixels: Uint8ClampedArray; name: string; notes: string[] };

const PRESET_NAMES: Record<string, string> = { explorer: 'Explorer', ember: 'Ember', frost: 'Frost', dusk: 'Dusk' };

export function NewSkinDialogBody({ onStart }: { onStart: (s: SkinStart) => void }) {
  const [model, setModel] = useState<SkinModel>('classic');
  const [preset, setPreset] = useState('explorer');
  const [imported, setImported] = useState<{ image: RgbaImage; notes: string[]; name: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const sking = useProvider('sking-v101c');

  async function onFile(file: File | undefined) {
    setImportError(null);
    setImported(null);
    if (!file) return;
    try {
      if (file.size > 512 * 1024) throw new Error('That file is too large to be a skin.');
      let { image } = decodePngToRgba(new Uint8Array(await file.arrayBuffer()));
      const notes: string[] = [];
      if (image.width === 64 && image.height === 32) {
        const c = convertLegacySkin(image);
        image = c.image;
        notes.push(...c.notes);
      } else if (image.width !== 64 || image.height !== 64) {
        throw new Error(`A skin must be 64×64 (or legacy 64×32) pixels; this image is ${image.width}×${image.height}.`);
      }
      const suggested = suggestModel(image);
      setModel(suggested);
      notes.push(`Detected arm style: ${suggested === 'slim' ? 'slim (3 px)' : 'classic (4 px)'}. Change it below if this is wrong.`);
      setImported({ image, notes, name: file.name.replace(/\.png$/i, '').slice(0, 40) || 'Imported skin' });
    } catch (e) {
      setImportError((e as Error).message);
    }
  }

  const importReport = imported ? validateSkinImage(imported.image, model) : null;

  return (
    <div className="space-y-4">
      <fieldset className="flex flex-wrap gap-4">
        <legend className="font-pixel mb-1">Arm style</legend>
        {(['classic', 'slim'] as const).map((m) => (
          <label key={m} className="flex items-center gap-2">
            <input type="radio" name="new-model" checked={model === m} onChange={() => setModel(m)} />
            {m === 'classic' ? 'Classic (4 px arms)' : 'Slim (3 px arms)'}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel className="p-4">
          <h3 className="mb-1 text-lg">Start from a template</h3>
          <p className="mb-2 text-sm text-muted">An original starter character you can repaint. Label: Manual.</p>
          <label className="mb-2 block text-sm">
            Colour scheme
            <select className="px-input mt-1" value={preset} onChange={(e) => setPreset(e.target.value)}>
              {Object.keys(TEMPLATE_PRESETS).map((k) => (
                <option key={k} value={k}>
                  {PRESET_NAMES[k] ?? k}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => onStart({ kind: 'template', model, pixels: createTemplateSkin(model, TEMPLATE_PRESETS[preset]).data, name: `${PRESET_NAMES[preset] ?? 'My'} skin` })}>
              Use template
            </Button>
            <Button onClick={() => onStart({ kind: 'blank', model, pixels: createBlankSkin(model).data, name: 'Blank skin' })}>Blank grey</Button>
          </div>
        </Panel>
        <Panel className="p-4">
          <h3 className="mb-1 text-lg">Import an existing skin</h3>
          <p className="mb-2 text-sm text-muted">A 64×64 PNG, or an old 64×32 skin (converted the way Minecraft does). Label: Manual.</p>
          <input type="file" accept="image/png" aria-label="Skin PNG to import" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
          {importError && <p role="alert" className="mt-2 text-sm text-redstone">{importError}</p>}
          {imported && (
            <div className="mt-2 space-y-1 text-sm text-muted">
              {imported.notes.map((n) => (
                <p key={n}>{n}</p>
              ))}
              {importReport?.issues
                .filter((i) => i.severity !== 'info')
                .map((i) => (
                  <p key={i.code} className={i.severity === 'error' ? 'text-gold' : 'text-muted'}>
                    {i.message} {i.severity === 'error' ? '(you can fix this in the editor before exporting)' : ''}
                  </p>
                ))}
              <Button variant="primary" onClick={() => onStart({ kind: 'import', model, pixels: imported.image.data, name: imported.name, notes: imported.notes })}>
                Open in editor
              </Button>
            </div>
          )}
        </Panel>
        <Panel className="p-4">
          <h3 className="mb-1 text-lg">From your photos</h3>
          <p className="mb-2 text-sm text-muted">
            Upload a front photo (back and sides optional), place guide boxes, and copy the colours onto a skin. Predictable code, no AI. Label:
            Photo-assisted.
          </p>
          <Button variant="primary" onClick={() => onStart({ kind: 'photo', model, pixels: createTemplateSkin(model).data, name: 'Photo skin' })}>
            Use my photos
          </Button>
        </Panel>
        <Panel className="p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="text-lg">AI skin (Sking)</h3>
            {sking.provider && <ProviderStatusBadge p={sking.provider} />}
          </div>
          <p className="mb-2 text-sm text-muted">Generates a skin from a two-view composite on a GPU server. Label: AI-generated.</p>
          {sking.provider && !sking.provider.available && <p className="mb-2 text-sm text-gold">{sking.provider.reason}</p>}
          <Button disabled={!sking.provider?.available} onClick={() => onStart({ kind: 'ai', model, pixels: createTemplateSkin(model).data, name: 'AI skin' })}>
            Continue with AI
          </Button>
        </Panel>
      </div>
      <Callout>
        <span className="mr-2">Just exploring?</span>
        <Button size="sm" onClick={() => onStart({ kind: 'sample', model, pixels: createUvDebugSkin(model).data, name: 'UV test pattern' })}>
          Load the UV test pattern (Demo sample)
        </Button>
        <span className="ml-2 text-xs">Each face has its own colour and a white/black marker in its top-left corner.</span>
      </Callout>
    </div>
  );
}
