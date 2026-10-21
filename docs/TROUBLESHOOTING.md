# Troubleshooting

| Symptom                             | Action                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `npm ci` engine warning             | Use Node 24.15+ (`nvm install && nvm use`). `.nvmrc` selects 24.                                                         |
| Cannot resolve workspace package    | `npm run build:packages` before development; production/e2e scripts build automatically.                                 |
| Worker virtualenv missing           | `cd services/ai-worker && uv sync --frozen`. For manual editors only use `npm run dev:manual`.                           |
| `uv` not found on this Mac          | Add `~/Library/Python/3.9/bin` to PATH or use the uv executable there.                                                   |
| API not reachable / exports fail    | Start API on port 4000. In production use the single-origin configuration in DEPLOYMENT.md.                              |
| Worker unavailable although healthy | Run `npm run setup`; match `AI_WORKER_TOKEN` in both env files and restart services. Health alone does not authenticate. |
| AI disabled / no CUDA               | Manual/photo-assisted editors work. Do not enable Sking on the Apple GPU; see MODELS_AND_LICENSES.md.                    |
| TripoSR unavailable                 | Requires the official checkout, isolated interpreter, local weights and working dependencies; not installed here.        |
| Images rejected                     | PNG/JPEG/WebP content only; default 10 MB and 20 million pixels. File renaming does not change format.                   |
| No 3D preview                       | Enable WebGL or try another browser. The skin's 2D editor/export and entity's flat fallback still work.                  |
| Save conflict                       | Load saved version or keep edits as a new project. Never repeatedly retry a stale revision.                              |
| Expired project                     | Restore browser draft if offered; re-upload references and download durable copies.                                      |
| Invalid skin export                 | Correct base-layer transparency (use Make base layer opaque), dimensions and selected arm model.                         |
| Invisible Bedrock entity            | Confirm both packs active, correct namespace, texture reference, Creator Content Log; run the manual game checklist.     |
| `MODEL_TOO_COMPLEX`                 | Lower mesh resolution/cube budget, simplify shapes/colours or remove cubes. Hard cap is 512 cubes.                       |
| Test API `listen EPERM`             | The execution sandbox blocks localhost sockets; run tests in a terminal that permits local test servers.                 |
| Missing Playwright executable       | `npx playwright install chromium` (CI adds `--with-deps`).                                                               |
| Container issue                     | Container execution is unverified locally; use `docker compose logs` and the CI container smoke stage.                   |

If `npm run dev` reports **Address already in use**, an earlier development
instance may still be running. Stop it with Ctrl+C in its original terminal
before restarting; do not run two copies on ports 5173/4000/8000. The worker
launcher isolates its reload process group, forwards shutdown once, and bounds
shutdown so an old worker cannot keep the port indefinitely.

Report the request ID, failing command, browser/OS and exact exported file, without
sharing session tokens or reference photos. The API returns bounded, structured
failures; a model failure must never be treated as a successful conversion.
