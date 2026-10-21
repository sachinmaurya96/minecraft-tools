import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { RgbaImage } from '@blockwright/shared';
import type { GuideBox } from '@blockwright/minecraft-skin';
import { rgbaToCanvas } from '../services/references';

const COLORS = ['#4fd1d9', '#f2c14e', '#e5484d', '#5b8def', '#5fb83f', '#c084fc', '#fb923c'];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Photo with movable/resizable guide boxes (normalized coordinates). Drag a box
 * to move it, drag its corner to resize. Keyboard: arrows move, Shift+arrows resize.
 */
export function GuideBoxEditor<K extends string>({
  image,
  boxes,
  labels,
  mask,
  onChange,
  maxWidth = 420,
  maxHeight = 520,
}: {
  image: RgbaImage;
  boxes: Record<K, GuideBox>;
  labels: Record<K, string>;
  mask?: Uint8Array;
  onChange: (next: Record<K, GuideBox>) => void;
  maxWidth?: number;
  maxHeight?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ key: K; mode: 'move' | 'resize'; startX: number; startY: number; box: GuideBox } | null>(null);
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 4);
  const w = Math.round(image.width * scale);
  const h = Math.round(image.height * scale);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(rgbaToCanvas(image), 0, 0, w, h);
    if (mask) {
      // tint detected background so users can see what is ignored
      const overlay = ctx.createImageData(image.width, image.height);
      for (let i = 0; i < mask.length; i++) if (mask[i]) overlay.data.set([229, 72, 77, 110], i * 4);
      const tmp = document.createElement('canvas');
      tmp.width = image.width;
      tmp.height = image.height;
      tmp.getContext('2d')!.putImageData(overlay, 0, 0);
      ctx.drawImage(tmp, 0, 0, w, h);
    }
  }, [image, mask, w, h]);

  const onPointerDown = (key: K, mode: 'move' | 'resize') => (e: PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { key, mode, startX: e.clientX, startY: e.clientY, box: { ...boxes[key] } };
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / w;
    const dy = (e.clientY - d.startY) / h;
    const b = d.box;
    const next =
      d.mode === 'move'
        ? { ...b, x: clamp01(Math.min(b.x + dx, 1 - b.w)), y: clamp01(Math.min(b.y + dy, 1 - b.h)) }
        : { ...b, w: Math.max(0.01, Math.min(1 - b.x, b.w + dx)), h: Math.max(0.01, Math.min(1 - b.y, b.h + dy)) };
    onChange({ ...boxes, [d.key]: next });
  };
  const onKey = (key: K) => (e: KeyboardEvent<HTMLElement>) => {
    const step = 0.005;
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = dirs[e.key];
    if (!d) return;
    e.preventDefault();
    const b = boxes[key];
    const next = e.shiftKey
      ? { ...b, w: Math.max(0.01, Math.min(1 - b.x, b.w + d[0])), h: Math.max(0.01, Math.min(1 - b.y, b.h + d[1])) }
      : { ...b, x: clamp01(Math.min(b.x + d[0], 1 - b.w)), y: clamp01(Math.min(b.y + d[1], 1 - b.h)) };
    onChange({ ...boxes, [key]: next });
  };

  const keys = Object.keys(boxes) as K[];
  return (
    <div ref={wrapRef} className="relative inline-block select-none border-2 border-shadow" style={{ width: w, height: h, touchAction: 'none' }} onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)}>
      <canvas ref={canvasRef} width={w} height={h} className="block" aria-hidden />
      {keys.map((k, i) => {
        const b = boxes[k];
        const color = COLORS[i % COLORS.length];
        return (
          <div
            key={k}
            role="group"
            tabIndex={0}
            aria-label={`${labels[k]} guide: x ${Math.round(b.x * 100)}%, y ${Math.round(b.y * 100)}%, width ${Math.round(b.w * 100)}%, height ${Math.round(b.h * 100)}%. Arrow keys move, Shift plus arrows resize.`}
            className="absolute cursor-move focus-visible:outline-diamond"
            style={{ left: b.x * w, top: b.y * h, width: b.w * w, height: b.h * h, border: `2px solid ${color}`, background: `${color}22` }}
            onPointerDown={onPointerDown(k, 'move')}
            onKeyDown={onKey(k)}
          >
            <span className="font-pixel absolute -top-5 left-0 whitespace-nowrap px-1 text-xs" style={{ background: color, color: '#111' }}>
              {labels[k]}
            </span>
            <span
              aria-hidden
              className="absolute -right-1.5 -bottom-1.5 h-3 w-3 cursor-se-resize border border-shadow"
              style={{ background: color }}
              onPointerDown={onPointerDown(k, 'resize')}
            />
          </div>
        );
      })}
    </div>
  );
}
