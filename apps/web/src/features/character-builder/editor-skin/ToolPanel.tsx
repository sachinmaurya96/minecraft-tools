import { hexToRgba, rgbaToHex, type SkinModel } from '@blockwright/shared';
import { BODY_PARTS, PART_LABELS } from '@blockwright/minecraft-skin';
import { cx } from '../../../components/ui';
import { useSkinEditor, type SkinTool } from './store';

const TOOLS: Array<{ id: SkinTool; label: string; key: string }> = [
  { id: 'pencil', label: 'Pencil', key: 'B' },
  { id: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'fill', label: 'Fill face', key: 'G' },
  { id: 'picker', label: 'Eyedropper', key: 'I' },
];

/** Original palette (no Minecraft texture colours copied). */
const PALETTE = [
  '#1d1d24', '#4b5563', '#9aa0a6', '#eceff4', '#4a2f1f', '#8b5a3c', '#c98f6b', '#f1cdb0',
  '#b5452b', '#e5484d', '#f2c14e', '#5fb83f', '#3d7f27', '#4fd1d9', '#3b6fd8', '#6b3f8f',
];

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function ToolPanel({ onModelChange }: { onModelChange: (m: SkinModel) => void }) {
  const s = useSkinEditor();
  const hex = rgbaToHex(s.color, false);
  const setHex = (h: string) => {
    try {
      const c = hexToRgba(h);
      s.setColor([c[0], c[1], c[2], s.color[3]]);
    } catch {
      /* ignore partial input */
    }
  };
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="font-pixel mb-1">Tool</legend>
        <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="Paint tool">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={s.tool === t.id}
              className={cx('px-btn px-btn-sm', s.tool === t.id ? 'px-btn-primary' : 'px-btn-secondary')}
              onClick={() => s.set('tool', t.id)}
              title={`${t.label} (${t.key})`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-pixel mb-1">Colour</legend>
        <div className="flex items-center gap-2">
          <input type="color" aria-label="Colour picker" value={hex} onChange={(e) => setHex(e.target.value)} className="h-9 w-12 cursor-pointer border-2 border-shadow bg-transparent" />
          <label className="sr-only" htmlFor="hex">
            Hex colour
          </label>
          <input id="hex" className="px-input font-mono text-sm" value={hex} onChange={(e) => setHex(e.target.value)} maxLength={7} />
        </div>
        <label className="mt-2 block text-xs text-muted" htmlFor="alpha">
          Opacity {Math.round((s.color[3] / 255) * 100)}% (outer layer only; base layer is always opaque)
        </label>
        <input id="alpha" type="range" min={0} max={255} value={s.color[3]} onChange={(e) => s.setColor([s.color[0], s.color[1], s.color[2], Number(e.target.value)])} className="w-full" />
        <div className="mt-2 grid grid-cols-8 gap-1" aria-label="Palette">
          {[...PALETTE, ...s.recentColors.filter((c) => !PALETTE.includes(c))].slice(0, 24).map((c) => (
            <button
              key={c}
              type="button"
              className={cx('aspect-square border-2', hex === c ? 'border-ink' : 'border-shadow')}
              style={{ background: c }}
              aria-label={`Use colour ${c}`}
              onClick={() => setHex(c)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-1">
        <legend className="font-pixel mb-1">Painting</legend>
        <Toggle label="Mirror left ↔ right (M)" checked={s.mirror} onChange={(v) => s.set('mirror', v)} />
      </fieldset>

      <fieldset className="space-y-1">
        <legend className="font-pixel mb-1">Model</legend>
        {(['classic', 'slim'] as const).map((m) => (
          <label key={m} className="flex items-center gap-2 text-sm">
            <input type="radio" name="model" checked={s.model === m} onChange={() => onModelChange(m)} />
            {m === 'classic' ? 'Classic (4 px arms)' : 'Slim (3 px arms)'}
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-1">
        <legend className="font-pixel mb-1">Show</legend>
        <Toggle label="Base layer" checked={s.showBase} onChange={(v) => s.set('showBase', v)} />
        <Toggle label="Outer layer" checked={s.showOverlay} onChange={(v) => s.set('showOverlay', v)} />
        {BODY_PARTS.map((p) => (
          <Toggle key={p} label={PART_LABELS[p]} checked={!s.hiddenParts.includes(p)} onChange={() => s.togglePart(p)} />
        ))}
        <Toggle label="Pixel grid" checked={s.showGrid} onChange={(v) => s.set('showGrid', v)} />
        <Toggle label="Face outlines" checked={s.showGuides} onChange={(v) => s.set('showGuides', v)} />
        {s.provenance.inferredRegions.length > 0 && <Toggle label="Mark approximate areas" checked={s.showInferred} onChange={(v) => s.set('showInferred', v)} />}
      </fieldset>
    </div>
  );
}
