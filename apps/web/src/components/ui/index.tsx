import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import type { ProvenanceLabel } from '@blockwright/shared';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Button({
  variant = 'secondary',
  size,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' }) {
  return <button type={type} className={cx('px-btn', `px-btn-${variant}`, size === 'sm' && 'px-btn-sm', className)} {...rest} />;
}

export function LinkButton({ variant = 'secondary', className, ...rest }: LinkProps & { variant?: Variant }) {
  return <Link className={cx('px-btn', `px-btn-${variant}`, className)} {...rest} />;
}

export function Panel({ className, children, as: Tag = 'section', ...rest }: { className?: string; children: ReactNode; as?: 'section' | 'div' | 'aside' | 'article' } & Record<string, unknown>) {
  return (
    <Tag className={cx('px-panel', className)} {...rest}>
      {children}
    </Tag>
  );
}

const PROVENANCE_STYLE: Record<ProvenanceLabel, string> = {
  'AI-generated': 'bg-gold text-night',
  'Photo-assisted': 'bg-lapis text-white',
  Manual: 'bg-grass-dark text-white',
  'Demo sample': 'bg-dirt text-white',
};

export function ProvenanceBadge({ label, edited }: { label: ProvenanceLabel; edited?: boolean }) {
  return (
    <span
      className={cx('font-pixel inline-block border-2 border-shadow px-2 py-0.5 text-xs uppercase tracking-wider', PROVENANCE_STYLE[label])}
      title={edited ? `${label}, then edited by hand` : label}
    >
      {label}
      {edited ? ' · edited' : ''}
    </span>
  );
}

export function StatusBadge({ tone, children }: { tone: 'ok' | 'warn' | 'off' | 'error'; children: ReactNode }) {
  const style = { ok: 'bg-grass-dark text-white', warn: 'bg-gold text-night', off: 'bg-panel-2 text-muted', error: 'bg-redstone text-white' }[tone];
  return <span className={cx('font-pixel inline-block border-2 border-shadow px-2 py-0.5 text-xs uppercase tracking-wider', style)}>{children}</span>;
}

export function Callout({ tone = 'info', title, children, className }: { tone?: 'info' | 'warn' | 'error' | 'ok'; title?: string; children: ReactNode; className?: string }) {
  const border = { info: 'border-lapis', warn: 'border-gold', error: 'border-redstone', ok: 'border-grass' }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'note'} className={cx('px-inset border-l-4 p-3 text-sm', border, className)}>
      {title && <p className="font-pixel mb-1 text-base">{title}</p>}
      <div className="text-muted [&_strong]:text-ink">{children}</div>
    </div>
  );
}

export function Spinner({ label = 'Working' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <span aria-hidden className="inline-block h-3 w-3 animate-spin bg-grass" style={{ animationDuration: '1.2s' }} />
      {label}
    </span>
  );
}

/** Modal built on the native <dialog> (focus trap, Esc to close, inert background). */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cx('px-panel m-auto max-h-[92dvh] w-[min(96vw,40rem)] overflow-auto p-0 text-ink backdrop:bg-black/70', wide && 'w-[min(96vw,72rem)]')}
    >
      {open && (
        <div className="p-4 sm:p-5">
          <div className="mb-3 flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-xl">
              {title}
            </h2>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog">
              ✕
            </Button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Continue',
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onClose={onCancel} title={title}>
      <div className="mb-4 text-sm text-muted">{message}</div>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

export { cx };
