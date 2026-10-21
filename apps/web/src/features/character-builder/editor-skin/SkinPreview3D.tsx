import { useEffect, useRef, useState } from 'react';
import { SkinViewer, WalkingAnimation } from 'skinview3d';
import { encodeRgbaPng, type SkinModel } from '@blockwright/shared';
import { BODY_PARTS, type BodyPart } from '@blockwright/minecraft-skin';
import { Button, Callout } from '../../../components/ui';
import { hasWebGL } from '../../../lib/webgl';

/**
 * skinview3d preview of the exact PNG bytes that will be exported: the editor
 * buffer is PNG-encoded, decoded without premultiplication and loaded. The
 * viewer is created after mount and disposed on unmount (StrictMode-safe).
 */
export function SkinPreview3D({
  pixels,
  model,
  showBase,
  showOverlay,
  hiddenParts,
  height = 380,
}: {
  pixels: Uint8ClampedArray;
  model: SkinModel;
  showBase: boolean;
  showOverlay: boolean;
  hiddenParts: BodyPart[];
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<SkinViewer | null>(null);
  const [webgl] = useState(hasWebGL);
  const [walking, setWalking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!webgl || !canvasRef.current || !wrapRef.current) return;
    let viewer: SkinViewer;
    try {
      viewer = new SkinViewer({ canvas: canvasRef.current, width: wrapRef.current.clientWidth || 320, height, zoom: 0.85, enableControls: true });
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    viewer.background = null;
    viewerRef.current = viewer;
    const ro = new ResizeObserver(() => {
      if (wrapRef.current && !viewer.disposed) viewer.setSize(wrapRef.current.clientWidth, height);
    });
    ro.observe(wrapRef.current);
    return () => {
      ro.disconnect();
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [webgl, height]);

  // reload the texture from the exact PNG bytes (debounced)
  useEffect(() => {
    if (!webgl) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.disposed) return;
      try {
        const png = encodeRgbaPng({ width: 64, height: 64, data: pixels });
        const bitmap = await createImageBitmap(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }), {
          premultiplyAlpha: 'none',
          colorSpaceConversion: 'none',
        });
        if (cancelled || viewer.disposed) return bitmap.close();
        viewer.loadSkin(bitmap, { model: model === 'slim' ? 'slim' : 'default' });
        bitmap.close();
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [pixels, model, webgl]);

  useEffect(() => {
    const skin = viewerRef.current?.playerObject.skin;
    if (!skin) return;
    skin.setInnerLayerVisible(showBase);
    skin.setOuterLayerVisible(showOverlay);
    for (const part of BODY_PARTS) skin[part].visible = !hiddenParts.includes(part);
  }, [showBase, showOverlay, hiddenParts, pixels]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer) viewer.animation = walking ? new WalkingAnimation() : null;
  }, [walking]);

  if (!webgl) {
    return (
      <Callout tone="warn" title="3D preview unavailable">
        Your browser has no WebGL, so the 3D preview cannot run. You can still edit in 2D and export a validated PNG.
      </Callout>
    );
  }
  return (
    <div>
      <div ref={wrapRef} className="px-inset relative w-full" style={{ height }}>
        <canvas ref={canvasRef} aria-label="3D preview of the skin. Drag to rotate, scroll or pinch to zoom." data-testid="skin-3d" />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => viewerRef.current?.resetCameraPose()}>
          Reset view
        </Button>
        <Button size="sm" aria-pressed={walking} onClick={() => setWalking((w) => !w)}>
          {walking ? 'Stop walking' : 'Walk'}
        </Button>
      </div>
      {error && (
        <Callout tone="error" className="mt-2">
          Preview error: {error}
        </Callout>
      )}
    </div>
  );
}
