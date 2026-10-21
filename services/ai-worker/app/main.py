"""Blockwright AI/geometry worker (internal service; never exposed to browsers).

GET  /health                       liveness (no auth)
GET  /v1/capabilities              runtime readiness per provider (bearer auth)
GET  /v1/diagnostics               all checks, ignoring ENABLE_* flags (bearer auth)
POST /v1/jobs                      multipart: type, params (JSON), files  -> 202
GET  /v1/jobs/{id}                 status
POST /v1/jobs/{id}/cancel          best-effort cancel (kills the child process)
GET  /v1/jobs/{id}/artifacts/{n}   download an output file
"""

from __future__ import annotations

import hmac
import logging
import platform

from fastapi import Depends, FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError

from . import __version__
from .adapters import optional_trellis
from .adapters.sking import PROVIDER_ID as SKING_ID
from .adapters.sking import SkingAdapter
from .adapters.triposr import PROVIDER_ID as TRIPOSR_ID
from .adapters.triposr import TripoSRAdapter
from .adapters.base import ProviderStatus
from .config import Settings, get_settings
from .jobs import JobRegistry, TaskError
from .tasks.registry import make_registry, parse_params

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def geometry_status() -> ProviderStatus:
    try:
        import scipy  # noqa: F401
        import trimesh  # noqa: F401
    except Exception:  # noqa: BLE001
        return ProviderStatus("error", "Geometry libraries failed to import on the worker.", "MODEL_NOT_CONFIGURED")
    return ProviderStatus("ready")


def create_app(settings: Settings | None = None) -> FastAPI:
    s = settings or get_settings()
    app = FastAPI(title="Blockwright worker", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
    registry = JobRegistry(s.worker_data_dir, max_workers=max(1, s.max_concurrent_gpu_jobs), ttl_s=s.job_ttl_s)
    sking = SkingAdapter(s)
    triposr = TripoSRAdapter(s)
    tasks = make_registry(sking, triposr)
    app.state.registry = registry
    app.state.settings = s

    def require_token(request: Request) -> None:
        if not s.ai_worker_token:
            raise HTTPException(503, "AI_WORKER_TOKEN is not configured on the worker")
        header = request.headers.get("authorization", "")
        scheme, _, token = header.partition(" ")
        if scheme.lower() != "bearer" or not hmac.compare_digest(token.encode(), s.ai_worker_token.encode()):
            raise HTTPException(401, "invalid worker token")

    auth = [Depends(require_token)]

    def provider_statuses(ignore_flags: bool = False) -> dict[str, dict]:
        return {
            SKING_ID: (sking.diagnose() if ignore_flags else sking.status()).as_dict(),
            TRIPOSR_ID: (triposr.diagnose() if ignore_flags else triposr.status()).as_dict(),
            "mesh-cuboids-v1": geometry_status().as_dict(),
            optional_trellis.PROVIDER_ID: optional_trellis.status().as_dict(),
        }

    @app.exception_handler(TaskError)
    async def task_error(_: Request, exc: TaskError):
        status = 503 if exc.code in ("GPU_UNAVAILABLE", "MODEL_NOT_CONFIGURED") else 413 if exc.code == "PAYLOAD_TOO_LARGE" else 400
        return JSONResponse({"error_code": exc.code, "error_message": exc.message}, status_code=status)

    @app.get("/health")
    def health():
        return {"status": "ok", "service": "blockwright-ai-worker", "version": __version__}

    @app.get("/v1/capabilities", dependencies=auth)
    def capabilities():
        return {"device": "cpu", "platform": platform.platform(), "providers": provider_statuses()}

    @app.get("/v1/diagnostics", dependencies=auth)
    def diagnostics():
        return {
            "platform": platform.platform(),
            "python": platform.python_version(),
            "flags": {"enable_sking": s.enable_sking, "enable_triposr": s.enable_triposr},
            "providers": provider_statuses(ignore_flags=True),
        }

    @app.post("/v1/jobs", dependencies=auth, status_code=202)
    async def submit(request: Request, type: str = Form(...), params: str = Form("{}")):
        spec = tasks.get(type)
        if spec is None:
            raise TaskError("BAD_REQUEST", f"Unknown job type '{type}'.")
        if type == "sking" and sking.status().status != "ready":
            st = sking.status()
            raise TaskError(st.code or "MODEL_NOT_CONFIGURED", st.reason or "Sking is not available")
        if type == "triposr" and triposr.status().status != "ready":
            st = triposr.status()
            raise TaskError(st.code or "MODEL_NOT_CONFIGURED", st.reason or "TripoSR is not available")
        form = await request.form()
        limit = s.max_upload_mb * 1024 * 1024
        files: dict[str, bytes] = {}
        names: dict[str, str] = {}
        for field, allowed in spec.files.items():
            upload = form.get(field)
            if not isinstance(upload, UploadFile) and not hasattr(upload, "read"):
                raise TaskError("BAD_REQUEST", f"Missing file field '{field}'.")
            filename = (getattr(upload, "filename", "") or "").lower()
            stored = next((a for a in allowed if a.endswith(filename.rsplit(".", 1)[-1])), allowed[0]) if filename else allowed[0]
            data = await upload.read(limit + 1)
            if len(data) > limit:
                raise TaskError("PAYLOAD_TOO_LARGE", f"'{field}' exceeds {s.max_upload_mb} MB.")
            files[stored] = data
            names[field] = stored
        p = parse_params(params)
        try:
            runner = spec.build(p, names)
        except ValidationError as e:
            raise TaskError("BAD_REQUEST", f"Invalid params: {e.errors()[0]['msg']}") from e
        job = registry.submit(type, p, files, runner)
        return job.view()

    @app.get("/v1/jobs/{job_id}", dependencies=auth)
    def get_job(job_id: str):
        job = registry.get(job_id)
        if not job:
            raise HTTPException(404, "unknown job")
        return job.view()

    @app.post("/v1/jobs/{job_id}/cancel", dependencies=auth)
    def cancel(job_id: str):
        job = registry.cancel(job_id)
        if not job:
            raise HTTPException(404, "unknown job")
        return job.view()

    @app.get("/v1/jobs/{job_id}/artifacts/{name}", dependencies=auth)
    def artifact(job_id: str, name: str):
        path = registry.artifact_path(job_id, name)
        if not path:
            raise HTTPException(404, "unknown artifact")
        return FileResponse(path, media_type="application/octet-stream")

    return app


app = create_app()
