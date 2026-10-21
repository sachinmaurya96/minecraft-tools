import { useState } from 'react';
import { PageMeta } from '../components/PageMeta';
import { Button, Callout, ConfirmDialog, Panel } from '../components/ui';
import { api, ApiError, forgetSession } from '../lib/api';
import { storage } from '../lib/storage';
import { useCapabilities } from '../lib/useCapabilities';

export function PrivacyPage() {
  const caps = useCapabilities();
  const hours = caps.data?.retentionHours;
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function deleteEverything() {
    setConfirm(false);
    try {
      const { deleted } = await api.deleteAllMyData();
      for (const k of ['bw.skinProject', 'bw.entityProject', 'bw.skinDraft', 'bw.entityDraft']) storage.remove(k);
      forgetSession();
      const total = Object.values(deleted).reduce((a, b) => a + b, 0);
      setStatus({ tone: 'ok', text: `Deleted ${total} stored item(s) and forgot this browser's session.` });
    } catch (e) {
      setStatus({ tone: 'error', text: e instanceof ApiError ? e.message : 'Deletion failed.' });
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <PageMeta title="Privacy & data deletion" description="What Blockwright stores, for how long, and how to delete it." />
      <h1 className="mb-4 text-3xl">Privacy</h1>
      <div className="space-y-4 text-muted [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:text-ink">
        <p>Short version: no accounts, no ads, no tracking cookies, and uploads are deleted automatically.</p>
        <h2>What is stored</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-ink">Reference photos</strong> you upload. The server re-encodes them, which removes EXIF/GPS and other metadata,
            and stores them privately under a random ID that only your browser session can use.
          </li>
          <li>
            <strong className="text-ink">Projects</strong> (your skin or entity) and recent revisions, plus files you export.
          </li>
          <li>
            <strong className="text-ink">A random session token</strong> in your browser's local storage, so the server knows which files are yours. It
            contains no personal information.
          </li>
        </ul>
        <h2>How long</h2>
        <p>
          Everything is deleted automatically {hours ? <strong className="text-ink">{hours} hours</strong> : 'a limited time'} after it was last
          saved. Download what you want to keep. You can also delete everything right now with the button below.
        </p>
        <h2>Who sees it</h2>
        <p>
          Nobody else. Photos are processed only on this service's own servers; they are not sent to third-party AI providers, not shown in any gallery
          and never used to train models.
        </p>
        <h2>Your responsibilities</h2>
        <p>
          Only upload images you have the right to use. Be careful with photos of other people, especially children: you need their (or their
          guardian's) permission. Do not upload illegal or hateful content.
        </p>
      </div>
      <Panel className="mt-8 p-5">
        <h2 className="mb-2 text-xl">Delete my data now</h2>
        <p className="mb-4 text-sm text-muted">
          Deletes every photo, project, generation job and export created by this browser, then forgets the session. This cannot be undone.
        </p>
        <Button variant="danger" onClick={() => setConfirm(true)}>
          Delete everything
        </Button>
        {status && (
          <Callout tone={status.tone} className="mt-4">
            {status.text}
          </Callout>
        )}
      </Panel>
      <ConfirmDialog
        open={confirm}
        title="Delete all of your data?"
        message="All uploads, projects and exports from this browser will be permanently deleted from the server."
        confirmLabel="Delete everything"
        danger
        onConfirm={deleteEverything}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
