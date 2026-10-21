import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { describePixel, getSkinLayout, regionKey } from '@blockwright/minecraft-skin';
import { linePoints } from './paint';
import { useSkinEditor } from './store';

const SIZE = 64;

/**
 * The 64x64 atlas editor. Pixels are drawn 1:1 into a 64x64 ImageData and scaled
 * with smoothing disabled, so zoom never blurs or shifts texels.
 */
export function PixelCanvas({ zoom }: { zoom: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufferRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef<{ last: [number, number] } | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [cursor, setCursor] = useState<[number, number]>([8, 8]);
  const s = useSkinEditor();
  const layout = useMemo(() => getSkinLayout(s.model), [s.model]);
  const px = SIZE * zoom;

  // render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    bufferRef.current ??= document.createElement('canvas');
    const buf = bufferRef.current;
    buf.width = SIZE;
    buf.height = SIZE;
    const bctx = buf.getContext('2d')!;
    const img = bctx.createImageData(SIZE, SIZE);
    img.data.set(s.pixels);
    // dim hidden layers/parts so the visible ones stand out
    for (const r of layout) {
      const hidden = (r.layer === 'base' && !s.showBase) || (r.layer === 'overlay' && !s.showOverlay) || s.hiddenParts.includes(r.part);
      if (!hidden) continue;
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) img.data[(y * SIZE + x) * 4 + 3] = Math.round(img.data[(y * SIZE + x) * 4 + 3]! * 0.12);
    }
    bctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(buf, 0, 0, px, px);

    if (s.showGrid && zoom >= 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < SIZE; i++) {
        ctx.moveTo(i * zoom + 0.5, 0);
        ctx.lineTo(i * zoom + 0.5, px);
        ctx.moveTo(0, i * zoom + 0.5);
        ctx.lineTo(px, i * zoom + 0.5);
      }
      ctx.stroke();
    }
    if (s.showInferred && s.provenance.inferredRegions.length) {
      ctx.save();
      ctx.strokeStyle = 'rgba(242,193,78,0.55)';
      ctx.lineWidth = 1;
      for (const r of layout) {
        if (!s.provenance.inferredRegions.includes(regionKey(r))) continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x * zoom, r.y * zoom, r.w * zoom, r.h * zoom);
        ctx.clip();
        ctx.beginPath();
        for (let d = -r.h * zoom; d < r.w * zoom; d += 6) {
          ctx.moveTo(r.x * zoom + d, r.y * zoom + r.h * zoom);
          ctx.lineTo(r.x * zoom + d + r.h * zoom, r.y * zoom);
        }
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
    if (s.showGuides) {
      ctx.lineWidth = 1;
      for (const r of layout) {
        ctx.strokeStyle = r.layer === 'base' ? 'rgba(79,209,217,0.55)' : 'rgba(242,193,78,0.5)';
        ctx.strokeRect(r.x * zoom + 0.5, r.y * zoom + 0.5, r.w * zoom - 1, r.h * zoom - 1);
      }
    }
    const mark = hover ?? (document.activeElement === canvas ? cursor : null);
    if (mark) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(mark[0] * zoom + 1, mark[1] * zoom + 1, zoom - 2, zoom - 2);
    }
  }, [
    s.pixels,
    s.showBase,
    s.showOverlay,
    s.hiddenParts,
    s.showGrid,
    s.showGuides,
    s.showInferred,
    s.provenance.inferredRegions,
    layout,
    zoom,
    px,
    hover,
    cursor,
  ]);

  const toPixel = useCallback((e: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * SIZE);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * SIZE);
    return [Math.max(0, Math.min(SIZE - 1, x)), Math.max(0, Math.min(SIZE - 1, y))];
  }, []);

  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toPixel(e);
    const st = useSkinEditor.getState();
    if (st.tool !== 'picker') st.beginStroke();
    st.applyTool([p]);
    drawing.current = st.tool === 'pencil' || st.tool === 'eraser' ? { last: p } : null;
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = toPixel(e);
    setHover(p);
    if (!drawing.current) return;
    const [lx, ly] = drawing.current.last;
    if (lx === p[0] && ly === p[1]) return;
    useSkinEditor.getState().applyTool(linePoints(lx, ly, p[0], p[1]).slice(1));
    drawing.current.last = p;
  };
  const onUp = () => {
    drawing.current = null;
  };

  const onKey = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      setCursor(([x, y]) => [Math.max(0, Math.min(63, x + m[0])), Math.max(0, Math.min(63, y + m[1]))]);
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const st = useSkinEditor.getState();
      if (st.tool !== 'picker') st.beginStroke();
      st.applyTool([cursor]);
    }
  };

  const info = hover ?? cursor;
  return (
    <div>
      <div className="checker inline-block max-w-full overflow-auto border-2 border-shadow">
        <canvas
          ref={canvasRef}
          width={px}
          height={px}
          style={{ width: px, height: px, touchAction: 'none', cursor: 'crosshair', display: 'block' }}
          tabIndex={0}
          role="application"
          aria-label={`Skin pixel editor, 64 by 64. Arrow keys move the cursor, Space paints with the current tool. Cursor at ${cursor[0]}, ${cursor[1]}: ${describePixel(s.model, cursor[0], cursor[1])}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          data-testid="pixel-canvas"
        />
      </div>
      <p className="mt-1 min-h-5 text-xs text-muted" aria-live="polite">
        {info[0]}, {info[1]} · {describePixel(s.model, info[0], info[1])}
      </p>
    </div>
  );
}
