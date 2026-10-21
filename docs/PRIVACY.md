# Storage and privacy behavior

There are no accounts, galleries, ad integrations or third-party inference APIs.
Images are processed on the configured API/worker hosts. Server operators can
access stored files; ownership checks isolate anonymous browser sessions from
one another. A session token is a bearer credential stored in browser localStorage.
Use HTTPS and protect data directories; do not log or share that token.

Uploads are decoded by content, bounded by bytes/pixels, normalized to PNG/JPEG,
and re-encoded without EXIF/GPS/XMP metadata. Original display filenames and
dimensions are stored. Raw original photo bytes are not retained by the API.

API uploads/projects/jobs/exports expire after `PROJECT_TTL_HOURS` (default 24).
Saving a project extends the TTL of its reference uploads. Expired records are
inaccessible immediately and physically swept at startup and every ten minutes.
The worker deletes job scratch after the API collects/fails/cancels it. If
cleanup cannot reach the worker, scratch expires after `JOB_TTL_S` (default six
hours); sweeping runs at startup and every minute. A running CPU task finishes
before its scratch directory is safely removed. Operators should account for
filesystem backups separately; this project does not manage backup retention.

Delete an individual reference to remove its normalized image/thumbnail. Privacy
→ Delete everything drains active session jobs before deleting records, avoiding
background jobs recreating deleted artifacts. It clears browser project IDs,
local drafts and in-memory editor state. Worker cleanup may be deferred to TTL
when the worker is offline. The session signing token has no account identity;
the UI forgets it after deletion.

Browser drafts contain skin/model edits and reference metadata, not photo
bytes. They remain until replaced or deleted; server TTL does not erase browser
storage. The API logs request method/path/status/request ID, not request headers
or bodies. Infrastructure access logs may retain IPs according to host policy.

Upload only images you have rights and consent to use. The service has no
automated moderation or consent verification. The on-site Terms/Privacy describe
the current implementation; a public operator must supply their own contact,
jurisdiction-specific policies, backup policy and operational retention details.
