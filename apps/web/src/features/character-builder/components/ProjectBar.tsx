import type { ReactNode } from 'react';
import { provenanceLabel, type Provenance } from '@blockwright/shared';
import { Button, ProvenanceBadge } from '../../../components/ui';

export type SaveStateView = 'idle' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error';

const SAVE_TEXT: Record<SaveStateView, string> = {
  idle: 'Not saved yet',
  saving: 'Saving…',
  saved: 'Saved',
  offline: 'Offline — kept locally',
  conflict: 'Changed elsewhere',
  error: 'Save failed',
};

export function ProjectBar({
  kindLabel,
  name,
  onRename,
  provenance,
  saveState,
  saveMessage,
  revision,
  dirty,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onHistory,
  children,
}: {
  kindLabel: string;
  name: string;
  onRename: (name: string) => void;
  provenance: Provenance;
  saveState: SaveStateView;
  saveMessage?: string;
  revision: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onHistory?: () => void;
  children?: ReactNode;
}) {
  const shown: SaveStateView = dirty && saveState === 'saved' ? 'idle' : saveState;
  return (
    <div className="px-panel mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="font-pixel text-sm text-muted">{kindLabel}</span>
        <label className="sr-only" htmlFor="project-name">
          Project name
        </label>
        <input
          id="project-name"
          className="px-input max-w-64 font-pixel text-lg"
          value={name}
          maxLength={48}
          onChange={(e) => onRename(e.target.value.replace(/[=\n\r\t]/g, ''))}
        />
        <ProvenanceBadge
          label={provenanceLabel(provenance)}
          edited={provenance.origin !== 'template' && provenance.origin !== 'blank' && provenance.editedAfterGeneration}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          role="status"
          aria-live="polite"
          className={`text-sm ${shown === 'error' || shown === 'conflict' ? 'text-redstone' : shown === 'offline' ? 'text-gold' : 'text-muted'}`}
          title={saveMessage}
          data-testid="save-state"
        >
          {SAVE_TEXT[shown]}
          {revision > 0 && shown === 'saved' ? ` · rev ${revision}` : ''}
        </span>
        <Button size="sm" onClick={onUndo} disabled={!canUndo} aria-label="Undo (Ctrl+Z)">
          Undo
        </Button>
        <Button size="sm" onClick={onRedo} disabled={!canRedo} aria-label="Redo (Ctrl+Shift+Z)">
          Redo
        </Button>
        {onHistory && (
          <Button size="sm" onClick={onHistory} disabled={revision === 0}>
            History
          </Button>
        )}
        {children}
      </div>
      {saveMessage && (shown === 'error' || shown === 'conflict' || shown === 'offline') && <p className="w-full text-sm text-muted">{saveMessage}</p>}
    </div>
  );
}
