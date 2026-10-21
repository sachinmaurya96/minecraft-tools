import { useEffect, useRef, useState, type DragEvent } from 'react';
import { IMAGE_ROLES, type ImageRole, type ReferenceImage, type Rotation } from '@blockwright/shared';
import { Button, Callout, ConfirmDialog, Spinner, cx } from '../../../components/ui';
import { api, ApiError } from '../../../lib/api';
import { storage } from '../../../lib/storage';
import { useCapabilities } from '../../../lib/useCapabilities';
import { precheckFile, ROLE_HINTS, ROLE_LABELS } from '../services/references';
import { CropDialog } from './CropDialog';

type SlotState = { busy?: boolean; error?: string; warnings?: string[] };

function Thumb({ reference }: { reference: ReferenceImage }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setFailed(false);
    api
      .getImageBlob(reference.temporaryAssetId, 'thumb')
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [reference.temporaryAssetId]);
  if (failed) return <p className="p-2 text-xs text-redstone">This upload has expired or was deleted. Upload it again.</p>;
  if (!url) return <Spinner label="Loading" />;
  return (
    <img
      src={url}
      alt={`${ROLE_LABELS[reference.role]} reference: ${reference.originalName}`}
      className="mx-auto max-h-36 object-contain"
      style={{ transform: `rotate(${reference.rotationDegrees}deg)` }}
    />
  );
}

/**
 * Four optional reference slots (front/back/left/right). Roles are unique:
 * dropping a file on a filled slot asks before replacing it.
 */
export function ReferencePanel({ references, onChange }: { references: ReferenceImage[]; onChange: (refs: ReferenceImage[]) => void }) {
  const caps = useCapabilities();
  const maxMb = caps.data?.limits.maxImageMb ?? 10;
  const hours = caps.data?.retentionHours ?? 24;
  const [consent, setConsent] = useState(storage.get('bw.uploadConsent') === '1');
  const [slots, setSlots] = useState<Partial<Record<ImageRole, SlotState>>>({});
  const [pendingReplace, setPendingReplace] = useState<{ role: ImageRole; file: File } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<ImageRole | null>(null);
  const [cropRole, setCropRole] = useState<ImageRole | null>(null);
  const inputs = useRef<Partial<Record<ImageRole, HTMLInputElement | null>>>({});
  const refsRef = useRef(references);
  refsRef.current = references;

  const byRole = (role: ImageRole) => references.find((r) => r.role === role);
  const setSlot = (role: ImageRole, s: SlotState) => setSlots((prev) => ({ ...prev, [role]: s }));

  async function upload(role: ImageRole, file: File) {
    const problem = precheckFile(file, maxMb);
    if (problem) return setSlot(role, { error: problem });
    setSlot(role, { busy: true });
    try {
      const { asset } = await api.uploadImage(file, 'reference');
      const current = refsRef.current;
      const old = current.find((r) => r.role === role);
      const hasPrimary = current.some((r) => r.isPrimary && r.role !== role);
      const ref: ReferenceImage = {
        id: `ref_${role}`,
        role,
        originalName: asset.originalName,
        mime: asset.mime,
        width: asset.width,
        height: asset.height,
        sizeBytes: asset.sizeBytes,
        temporaryAssetId: asset.id,
        rotationDegrees: 0,
        isPrimary: old?.isPrimary ?? (!hasPrimary && (role === 'front' || current.length === 0)),
      };
      onChange([...current.filter((r) => r.role !== role), ref].sort((a, b) => IMAGE_ROLES.indexOf(a.role) - IMAGE_ROLES.indexOf(b.role)));
      if (old) api.deleteImage(old.temporaryAssetId).catch(() => undefined);
      setSlot(role, { warnings: asset.warnings });
    } catch (e) {
      setSlot(role, { error: e instanceof ApiError ? e.message : 'Upload failed.' });
    }
  }

  function pick(role: ImageRole, file: File | undefined) {
    if (!file) return;
    if (byRole(role)) setPendingReplace({ role, file });
    else void upload(role, file);
  }

  function update(role: ImageRole, patch: Partial<ReferenceImage>) {
    onChange(references.map((r) => (r.role === role ? { ...r, ...patch } : r)));
  }

  function remove(role: ImageRole) {
    const ref = byRole(role);
    if (!ref) return;
    let rest = references.filter((r) => r.role !== role);
    if (ref.isPrimary && rest.length) {
      const next = rest.find((r) => r.role === 'front') ?? rest[0]!;
      rest = rest.map((r) => ({ ...r, isPrimary: r.role === next.role }));
    }
    onChange(rest);
    api.deleteImage(ref.temporaryAssetId).catch(() => undefined);
    setSlot(role, {});
  }

  const onDrop = (role: ImageRole) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!consent) return;
    pick(role, e.dataTransfer.files?.[0]);
  };

  return (
    <section aria-labelledby="refs-title">
      <h2 id="refs-title" className="mb-2 text-lg">
        Reference photos <span className="text-sm text-muted">(optional)</span>
      </h2>
      <label className="px-inset mb-3 flex items-start gap-2 p-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={consent}
          onChange={(e) => {
            setConsent(e.target.checked);
            storage.set('bw.uploadConsent', e.target.checked ? '1' : '0');
          }}
        />
        <span>
          I have the right to use these images (and permission from anyone shown in them). They are stored privately, metadata is removed, and they are deleted
          automatically after {hours} hours. <a href="/privacy">Privacy</a>
        </span>
      </label>
      <ul className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {IMAGE_ROLES.map((role) => {
          const ref = byRole(role);
          const slot = slots[role] ?? {};
          return (
            <li key={role}>
              <div
                className={cx('px-inset flex h-full flex-col p-2', !consent && 'opacity-60')}
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop(role)}
                data-testid={`ref-slot-${role}`}
              >
                <div className="mb-1 flex items-center justify-between gap-1">
                  <span className="font-pixel">{ROLE_LABELS[role]}</span>
                  {ref?.isPrimary && <span className="font-pixel text-xs text-gold">Primary</span>}
                </div>
                <div className="flex min-h-36 items-center justify-center overflow-hidden">
                  {slot.busy ? (
                    <Spinner label="Uploading and checking" />
                  ) : ref ? (
                    <Thumb reference={ref} />
                  ) : (
                    <p className="p-2 text-center text-xs text-muted">{ROLE_HINTS[role]}</p>
                  )}
                </div>
                {ref && (
                  <p
                    className="truncate text-xs text-muted"
                    title={ref.originalName}
                  >{`${ref.originalName} · ${ref.width}×${ref.height}${ref.crop ? ' · cropped' : ''}`}</p>
                )}
                {slot.error && (
                  <p role="alert" className="mt-1 text-xs text-redstone">
                    {slot.error}
                  </p>
                )}
                {slot.warnings?.map((w) => (
                  <p key={w} className="mt-1 text-xs text-gold">
                    {w}
                  </p>
                ))}
                <input
                  ref={(el) => {
                    inputs.current[role] = el;
                  }}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  aria-label={`${ref ? 'Replace' : 'Upload'} ${ROLE_LABELS[role]} image`}
                  disabled={!consent || slot.busy}
                  onChange={(e) => {
                    pick(role, e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button size="sm" disabled={!consent || slot.busy} onClick={() => inputs.current[role]?.click()}>
                    {ref ? 'Replace' : 'Upload'}
                  </Button>
                  {ref && (
                    <>
                      <Button
                        size="sm"
                        aria-label={`Rotate ${ROLE_LABELS[role]} 90 degrees clockwise`}
                        onClick={() => update(role, { rotationDegrees: ((ref.rotationDegrees + 90) % 360) as Rotation, crop: undefined })}
                      >
                        ⟳
                      </Button>
                      <Button size="sm" onClick={() => setCropRole(role)}>
                        Crop
                      </Button>
                      {!ref.isPrimary && (
                        <Button size="sm" onClick={() => onChange(references.map((r) => ({ ...r, isPrimary: r.role === role })))}>
                          Use as primary
                        </Button>
                      )}
                      <Button size="sm" variant="danger" onClick={() => setPendingRemove(role)}>
                        Remove
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {!consent && <Callout className="mt-2">Tick the box above to enable uploads. You can also skip photos and start from a template.</Callout>}
      <ConfirmDialog
        open={!!pendingReplace}
        title={`Replace the ${pendingReplace ? ROLE_LABELS[pendingReplace.role].toLowerCase() : ''} image?`}
        message="The current image for this view will be deleted from the server."
        confirmLabel="Replace"
        onCancel={() => setPendingReplace(null)}
        onConfirm={() => {
          const p = pendingReplace!;
          setPendingReplace(null);
          void upload(p.role, p.file);
        }}
      />
      <ConfirmDialog
        open={!!pendingRemove}
        title="Remove this reference?"
        message="The image will be deleted from the server. Your skin or model is not changed."
        confirmLabel="Remove"
        danger
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          remove(pendingRemove!);
          setPendingRemove(null);
        }}
      />
      {cropRole && byRole(cropRole) && (
        <CropDialog reference={byRole(cropRole)!} open onClose={() => setCropRole(null)} onApply={(crop) => update(cropRole, { crop })} />
      )}
    </section>
  );
}
