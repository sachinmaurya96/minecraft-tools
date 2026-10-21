# HTTP API

The public API is `/api/v1`. JSON responses use `{ data, error, requestId }`;
errors have a stable `code`, readable `message`, and optional `details`.
`X-Request-Id` also appears in the response header. Downloads return binary bytes.

Create an anonymous session with `POST /api/v1/sessions` (no body). Keep the
returned `data.token` private and send `X-Session-Token: <token>` for all private
endpoints. A different session gets 404 for someone else's files. No accounts
or automatic installation into Minecraft are provided.

| Method | Path (under `/api/v1`)                     | Request/result                                                                                                |
| ------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/capabilities`                            | Public provider availability, reasons, limits, retention                                                      |
| POST   | `/sessions`                                | New token and retention hours                                                                                 |
| GET    | `/sessions/current`                        | Verify session                                                                                                |
| DELETE | `/sessions/current`                        | Stop jobs; delete this session's assets/projects/jobs/exports                                                 |
| POST   | `/assets/images`                           | Multipart `file`, optional `purpose=reference` or `composite`; normalized image metadata                      |
| GET    | `/assets/images/:id`                       | Image metadata                                                                                                |
| GET    | `/assets/images/:id/content?variant=thumb` | Normalized full image or thumbnail                                                                            |
| DELETE | `/assets/images/:id`                       | Delete an image                                                                                               |
| POST   | `/assets/meshes`                           | Multipart `file` (.glb/.obj); mesh metadata                                                                   |
| DELETE | `/assets/meshes/:id`                       | Delete a mesh                                                                                                 |
| POST   | `/projects/skin`                           | `{ state, skinPngBase64? , template?: {kind: 'template' or 'blank', preset?} }`                               |
| POST   | `/projects/entity`                         | `{ state }`                                                                                                   |
| GET    | `/projects/:id`                            | Project plus exact `skinPngBase64` for skins                                                                  |
| PUT    | `/projects/:id`                            | `{ baseRevision, state, skinPngBase64?, label? }`; new revision                                               |
| DELETE | `/projects/:id`                            | Delete project, revisions and project exports                                                                 |
| GET    | `/projects/:id/revisions`                  | Revision history                                                                                              |
| POST   | `/projects/:id/revert`                     | `{ baseRevision, toRevision }`; creates a new revision                                                        |
| POST   | `/projects/:id/apply`                      | `{ baseRevision, artifactId }`; apply a completed generated result                                            |
| POST   | `/exports/skin`                            | `{ projectId, revision }`; validated artifact and report                                                      |
| POST   | `/exports/bedrock-addon`                   | `{ projectId, revision, includeRaw?: boolean }`; add-on, optional geometry/texture, report                    |
| GET    | `/artifacts/:id`                           | Artifact metadata                                                                                             |
| GET    | `/artifacts/:id/download`                  | Owner-scoped file, safe filename and `X-Artifact-Sha256`                                                      |
| POST   | `/jobs/skin-generate`                      | `{ projectId, compositeAssetId }`                                                                             |
| POST   | `/jobs/mesh-generate`                      | `{ projectId?, imageAssetId, rotationDegrees?, crop?, removeBackground?, foregroundRatio?, mcResolution? }`   |
| POST   | `/jobs/mesh-to-cuboids`                    | `{ projectId?, source: {kind:'mesh-asset',assetId} or {kind:'artifact',artifactId}, resolution?, maxCubes? }` |
| GET    | `/jobs/:id`                                | Job status/stage/result/errors                                                                                |
| POST   | `/jobs/:id/cancel`                         | Cancel a nonterminal job                                                                                      |

`GET /health` is public and outside the API prefix. Jobs return 202; poll until
`ready`, `failed` or `cancelled`. Apply a result explicitly before exporting.
`REVISION_CONFLICT` (409) means refresh the server version or save a separate
project; stale writes never silently overwrite newer work. Invalid exports
return 422 with a validation report. Disabled providers return 503 with a reason.

The exact state schemas and bounds live in `packages/shared/src/projects.ts`
and `apps/api/src/jobs/jobManager.ts`. AI provenance is assigned by the server;
clients cannot declare a manual project AI-generated.

The Python worker is internal: `/health` is public; `/v1/capabilities`,
`/v1/diagnostics`, multipart `/v1/jobs`, job status/cancel/delete/artifact routes
require `Authorization: Bearer <AI_WORKER_TOKEN>`. Never expose its port publicly.
The API removes worker copies after collecting a result. Failed cleanup falls
back to worker TTL sweeping.
