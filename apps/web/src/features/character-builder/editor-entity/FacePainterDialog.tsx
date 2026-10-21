import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { base64ToBytes, bytesToBase64, createImage, hexToRgba, resizeNearest, rgbaToHex, type Cube, type Rgba, type RgbaImage, type VoxelFace } from '@blockwright/shared';
import { FACE_LABELS, faceTexelSize } from '@blockwright/bedrock-export';
import { Button, Callout, Dialog, cx } from '../../../components/ui';
import { linePoints } from '../editor-skin/paint';
import { useEntityEditor } from './store';

/** What lies beyond each edge of a face bitmap, seen from outside (see bedrock-export/faces.ts). */
const EDGES: Record<VoxelFace, { top: string; bottom: string; left: string; right: string }> = {
  north: { top: 'Up', bottom: 'Down', left: "Entity's right", right: "Entity's left" },
  south: { top: 'Up', bottom: 'Down', left: "Entity's left", right: "Entity's right" },
  east: { top: 'Up', bottom: 'Down', left: 'Back', right: 'Front' },
  west: { top: 'Up', bottom: 'Down', left: 'Front', right: 'Back' },
  up: { top: 'Front', bottom: 'Back', left: "Entity's left", right: "Entity's right" },
  down: { top: 'Back', bottom: 'Front', left: "Entity's left", right: "Entity's right" },
};

function initialBitmap(cube: Cube, face: VoxelFace): RgbaImage {
  const [w, h] = faceTexelSize(cube.size, face);
  const paint = cube.faces?.[face];
  if (paint?.kind === 'pixels') {
    const img = { width: paint.width, height: paint.height, data: new Uint8ClampedArray(base64ToBytes(paint.rgba)) };
    return img.width === w && img.height === h ? img : resizeNearest(img, w, h);
  }
  return createImage(w, h, hexToRgba(paint?.kind === 'color' ? paint.color : cube.color));
}

export function FacePainterDialog({ cube, face, onClose }: { cube: Cube; face: VoxelFace; onClose: () => void }) {
  const [bmp, setBmp] = useState<RgbaImage>(() => initialBitmap(cube, face));
  const [color, setColor] = useState<Rgba>(hexToRgba(cube.color));
  const [tool, setTool] = useState<'pencil' | 'fill' | 'picker' | 'eraser'>('pencil');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const last = useRef<[number, number] | null>(null);
  const zoom = Math.max(4, Math.min(32, Math.floor(320 / Math.max(bmp.width, bmp.height))));
  const edges = EDGES[face];

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const tmp = document.createElement('canvas');
    tmp.width = bmp.width;
    tmp.height = bmp.height;
    const d = tmp.getContext('2d')!.createImageData(bmp.width, bmp.height);
    d.data.set(bmp.data);
    tmp.getContext('2d')!.putImageData(d, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, bmp.width * zoom, bmp.height * zoom);
    ctx.drawImage(tmp, 0, 0, bmp.width * zoom, bmp.height * zoom);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let x = 1; x < bmp.width; x++) ctx.strokeRect(x * zoom, 0, 0, bmp.height * zoom);
    for (let y = 1; y < bmp.height; y++) ctx.strokeRect(0, y * zoom, bmp.width * zoom, 0);
  }, [bmp, zoom]);

  const at = (e: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.min(bmp.width - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * bmp.width))), Math.min(bmp.height - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * bmp.height)))];
  };

  function apply(points: Array<[number, number]>) {
    if (tool === 'picker') {
      const [x, y] = points[0]!;
      const i = (y * bmp.width + x) * 4;
      if (bmp.data[i + 3]) setColor([bmp.data[i]!, bmp.data[i + 1]!, bmp.data[i + 2]!, 255]);
      setTool('pencil');
      return;
    }
    const out = { ...bmp, data: new Uint8ClampedArray(bmp.data) };
    const c: Rgba = tool === 'eraser' ? [0, 0, 0, 0] : color;
    if (tool === 'fill') {
      const [sx, sy] = points[0]!;
      const i0 = (sy * bmp.width + sx) * 4;
      const target = [...bmp.data.slice(i0, i0 + 4)];
      const stack: Array<[number, number]> = [[sx, sy]];
      const seen = new Set<number>();
      while (stack.length) {
        const [x, y] = stack.pop()!;
        if (x < 0 || y < 0 || x >= bmp.width || y >= bmp.height || seen.has(y * bmp.width + x)) continue;
        seen.add(y * bmp.width + x);
        const i = (y * bmp.width + x) * 4;
        if (out.data[i] !== target[0] || out.data[i + 1] !== target[1] || out.data[i + 2] !== target[2] || out.data[i + 3] !== target[3]) continue;
        out.data.set(c, i);
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
    } else {
      for (const [x, y] of points) out.data.set(c, (y * bmp.width + x) * 4);
    }
    setBmp(out);
  }

  function save() {
    const first = bmp.data.slice(0, 4);
    const uniform = bmp.data.every((v, i) => v === first[i % 4]);
    const faces = { ...(cube.faces ?? {}) };
    faces[face] = uniform && first[3] === 255 ? { kind: 'color', color: rgbaToHex([first[0]!, first[1]!, first[2]!, 255]) } : { kind: 'pixels', width: bmp.width, height: bmp.height, rgba: bytesToBase64(bmp.data) };
    useEntityEditor.getState().updateCube(cube.id, { faces });
    onClose();
  }

  const hasHoles = bmp.data.some((v, i) => i % 4 === 3 && v < 255);
  return (
    <Dialog open onClose={onClose} title={`Paint ${FACE_LABELS[face]} of “${cube.name ?? cube.id}”`}>
      <p className="mb-2 text-sm text-muted">
        {bmp.width} × {bmp.height} texels, shown as seen from outside the cube.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(['pencil', 'fill', 'picker', 'eraser'] as const).map((t) => (
          <button key={t} type="button" className={cx('px-btn px-btn-sm', tool === t ? 'px-btn-primary' : 'px-btn-secondary')} aria-pressed={tool === t} onClick={() => setTool(t)}>
            {t === 'picker' ? 'Eyedropper' : t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
        <input type="color" aria-label="Paint colour" value={rgbaToHex(color, false)} onChange={(e) => setColor(hexToRgba(e.target.value))} className="h-8 w-10 border-2 border-shadow bg-transparent" />
        <Button size="sm" onClick={() => setBmp(createImage(bmp.width, bmp.height, color))}>
          Fill all
        </Button>
      </div>
      <div className="inline-grid grid-cols-[auto_auto_auto] items-center gap-1 text-xs text-muted">
        <span />
        <span className="text-center">{edges.top}</span>
        <span />
        <span className="max-w-16 text-right">{edges.left}</span>
        <canvas
          ref={canvasRef}
          width={bmp.width * zoom}
          height={bmp.height * zoom}
          className="checker border-2 border-shadow"
          style={{ touchAction: 'none', cursor: 'crosshair' }}
          aria-label={`Face texture ${bmp.width} by ${bmp.height}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = at(e);
            last.current = p;
            apply([p]);
          }}
          onPointerMove={(e) => {
            if (!last.current || (tool !== 'pencil' && tool !== 'eraser')) return;
            const p = at(e);
            apply(linePoints(last.current[0], last.current[1], p[0], p[1]));
            last.current = p;
          }}
          onPointerUp={() => (last.current = null)}
        />
        <span className="max-w-16">{edges.right}</span>
        <span />
        <span className="text-center">{edges.bottom}</span>
        <span />
      </div>
      {hasHoles && (
        <Callout tone="warn" className="mt-2">
          Transparent texels make holes in the model; the add-on then uses an alpha-tested material.
        </Callout>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save}>
          Apply to face
        </Button>
      </div>
    </Dialog>
  );
}
