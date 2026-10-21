import { cropImage, rotateImage, type ImageRole, type ReferenceImage, type RgbaImage } from '@blockwright/shared';
import { api } from '../../../lib/api';

export const ROLE_LABELS: Record<ImageRole, string> = {
  front: 'Front',
  back: 'Back',
  left: "Character's left side",
  right: "Character's right side",
};

export const ROLE_HINTS: Record<ImageRole, string> = {
  front: 'Facing the camera, full body if possible. Required for photo-assisted skins.',
  back: 'Seen from behind. Optional: without it the back is approximated.',
  left: 'Camera at the character’s left. Optional.',
  right: 'Camera at the character’s right. Optional.',
};

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];

/** Fast client-side checks; the server re-validates everything by content. */
export function precheckFile(file: File, maxMb: number): string | null {
  if (!ACCEPT.includes(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) return 'Use a PNG, JPEG or WebP image.';
  if (file.size > maxMb * 1024 * 1024) return `The file is larger than ${maxMb} MB.`;
  if (file.size === 0) return 'The file is empty.';
  return null;
}

const rgbaCache = new Map<string, Promise<RgbaImage>>();

/** Decode a stored reference (normalized server copy) into RGBA, then apply its rotation and crop. */
export function loadReferenceRgba(ref: ReferenceImage): Promise<RgbaImage> {
  const key = `${ref.temporaryAssetId}:${ref.rotationDegrees}:${JSON.stringify(ref.crop ?? null)}`;
  let p = rgbaCache.get(key);
  if (!p) {
    p = (async () => {
      const blob = await api.getImageBlob(ref.temporaryAssetId, 'full');
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let img: RgbaImage = { width: data.width, height: data.height, data: data.data };
      img = rotateImage(img, ref.rotationDegrees);
      if (ref.crop) img = cropImage(img, ref.crop);
      return img;
    })();
    p.catch(() => rgbaCache.delete(key));
    rgbaCache.set(key, p);
  }
  return p;
}

/** Draw an RgbaImage into a fresh canvas (display only; never used for exact pixels). */
export function rgbaToCanvas(img: RgbaImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  const data = ctx.createImageData(img.width, img.height);
  data.data.set(img.data);
  ctx.putImageData(data, 0, 0);
  return canvas;
}
