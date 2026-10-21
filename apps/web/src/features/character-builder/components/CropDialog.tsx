import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { CropRect, ReferenceImage, RgbaImage } from '@blockwright/shared';
import { Button, Callout, Dialog, Spinner } from '../../../components/ui';
import { loadReferenceRgba, rgbaToCanvas } from '../services/references';

/** Drag a rectangle over the (rotated) photo to crop it. Crop is stored as metadata; the original stays on the server. */
export function CropDialog({ reference, open, onClose, onApply }: { reference: ReferenceImage; open: boolean; onClose: () => void; onApply: (crop: CropRect | undefined) => void }) {
  const [img, setImg] = useState<RgbaImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rect, setRect] = useState<CropRect | undefined>(reference.crop);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setRect(reference.crop);
    loadReferenceRgba({ ...reference, crop: undefined })
      .then(setImg)
      .catch((e) => setError((e as Error).message));
  }, [open, reference]);

  const scale = img ? Math.min(1, 560 / img.width, 420 / img.height) : 1;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !img) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(rgbaToCanvas(img), 0, 0, c.width, c.height);
    if (rect) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.rect(0, 0, c.width, c.height);
      ctx.rect(rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#4fd1d9';
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale);
    }
  }, [img, rect, scale]);

  const toImg = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(img!.width, Math.round(((e.clientX - r.left) / r.width) * img!.width))),
      y: Math.max(0, Math.min(img!.height, Math.round(((e.clientY - r.top) / r.height) * img!.height))),
    };
  };

  return (
    <Dialog open={open} onClose={onClose} title={`Crop: ${reference.originalName}`} wide>
      {error && <Callout tone="error">Could not load the image: {error}</Callout>}
      {!img && !error && <Spinner label="Loading image" />}
      {img && (
        <>
          <p className="mb-2 text-sm text-muted">Drag a box around the character. Tighter crops give better photo-assisted results.</p>
          <canvas
            ref={canvasRef}
            width={Math.round(img.width * scale)}
            height={Math.round(img.height * scale)}
            className="max-w-full border-2 border-shadow"
            style={{ touchAction: 'none', cursor: 'crosshair' }}
            aria-label="Crop area. Drag to select."
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = toImg(e);
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const p = toImg(e);
              const x = Math.min(p.x, drag.current.x);
              const y = Math.min(p.y, drag.current.y);
              const w = Math.abs(p.x - drag.current.x);
              const h = Math.abs(p.y - drag.current.y);
              if (w >= 4 && h >= 4) setRect({ x, y, width: w, height: h });
            }}
            onPointerUp={() => (drag.current = null)}
          />
          <p className="mt-2 text-xs text-muted">{rect ? `Crop: ${rect.width} × ${rect.height} px at (${rect.x}, ${rect.y})` : 'No crop (whole image).'}</p>
          <div className="mt-3 flex justify-end gap-2">
            <Button onClick={() => setRect(undefined)}>Reset</Button>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                onApply(rect && rect.width >= 8 && rect.height >= 8 ? rect : undefined);
                onClose();
              }}
            >
              Apply crop
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
