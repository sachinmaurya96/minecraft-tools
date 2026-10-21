"""Adapter tests. Fakes in tests/fakes imitate only the official CLI contracts."""

from __future__ import annotations

import io
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.adapters.sking import SkingAdapter
from app.adapters.triposr import TripoSRAdapter
from app.config import WORKER_ROOT
from app.main import create_app

from .conftest import AUTH, make_settings, wait_job

FAKES = Path(__file__).parent / "fakes"
REAL_SKING = WORKER_ROOT / "models" / "Sking" / "SKING_DDJ_v101c"


def png(w: int, h: int) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (10, 20, 30)).save(buf, "PNG")
    return buf.getvalue()


def fake_cuda(monkeypatch):
    monkeypatch.setattr(SkingAdapter, "torch_info", lambda self, python: {"ok": True, "cuda": True, "gpu": "FakeGPU", "torch": "x"})


@pytest.fixture
def sking_client(tmp_path, monkeypatch):
    fake_cuda(monkeypatch)
    s = make_settings(
        tmp_path,
        enable_sking=True,
        sking_dir=FAKES / "sking",
        sking_parser_python=sys.executable,
        sking_foreground_python=sys.executable,
    )
    return TestClient(create_app(s))


def submit_sking(client, data: bytes):
    return client.post("/v1/jobs", headers=AUTH, data={"type": "sking", "params": "{}"}, files={"composite": ("c.png", data, "image/png")})


def test_sking_ready_only_with_bundle_envs_and_cuda(sking_client):
    p = sking_client.get("/v1/capabilities", headers=AUTH).json()["providers"]["sking-v101c"]
    assert p["status"] == "ready"


def test_sking_without_cuda_is_gpu_unavailable(tmp_path, monkeypatch):
    monkeypatch.setattr(SkingAdapter, "torch_info", lambda self, python: {"ok": True, "cuda": False})
    s = make_settings(tmp_path, enable_sking=True, sking_dir=FAKES / "sking", sking_parser_python=sys.executable, sking_foreground_python=sys.executable)
    st = SkingAdapter(s).status()
    assert (st.status, st.code) == ("unavailable", "GPU_UNAVAILABLE")


def test_sking_job_runs_launcher_and_validates_output(sking_client, monkeypatch):
    monkeypatch.setenv("FAKE_SKING_MODE", "ok")
    job = wait_job(sking_client, submit_sking(sking_client, png(512, 512)).json()["id"])
    assert job["status"] == "ready", job
    assert job["result"]["model_version"] == "SKING_DDJ_v101c"
    data = sking_client.get(f"/v1/jobs/{job['id']}/artifacts/skin.png", headers=AUTH).content
    with Image.open(io.BytesIO(data)) as im:
        assert im.size == (64, 64) and im.mode == "RGBA"


@pytest.mark.parametrize(("mode", "message"), [("fail", "exited with code 3"), ("badsha", "provenance"), ("small", "64x64")])
def test_sking_failures_are_reported_not_faked(sking_client, monkeypatch, mode, message):
    monkeypatch.setenv("FAKE_SKING_MODE", mode)
    job = wait_job(sking_client, submit_sking(sking_client, png(512, 512)).json()["id"])
    assert job["status"] == "failed"
    assert message in job["error_message"]
    assert job["artifacts"] == []


@pytest.mark.parametrize("size", [(512, 256), (255, 255), (513, 513), (5000, 5000)])
@pytest.mark.filterwarnings("ignore::PIL.Image.DecompressionBombWarning")
def test_sking_rejects_bad_composites(sking_client, size):
    job = wait_job(sking_client, submit_sking(sking_client, png(*size)).json()["id"])
    assert job["status"] == "failed"
    assert job["error_code"] in ("BAD_IMAGE", "IMAGE_TOO_LARGE")


@pytest.mark.skipif(not (REAL_SKING / "infer.py").is_file(), reason="real Sking bundle not downloaded")
def test_real_sking_bundle_verifies_but_cannot_run_without_cuda(tmp_path):
    s = make_settings(tmp_path, enable_sking=True, sking_dir=REAL_SKING, sking_parser_python=sys.executable, sking_foreground_python=sys.executable)
    st = SkingAdapter(s).diagnose()
    assert st.details["verify_only"]["ok"] is True
    assert st.details["verify_only"]["verified_files"] == 88
    # the worker's own interpreter has no PyTorch, and this machine has no CUDA either way
    assert st.status == "unavailable"


# --------------------------------------------------------------------- TripoSR


@pytest.fixture
def triposr_settings(tmp_path):
    weights = tmp_path / "weights"
    weights.mkdir()
    (weights / "config.yaml").write_text("fake: true\n")
    (weights / "model.ckpt").write_bytes(b"fake")
    return make_settings(
        tmp_path, enable_triposr=True, triposr_dir=FAKES / "triposr", triposr_python=sys.executable, triposr_model=str(weights), triposr_timeout_s=5
    )


@pytest.fixture
def triposr_client(triposr_settings, monkeypatch):
    monkeypatch.setattr(TripoSRAdapter, "diagnose", _ready_diagnose)
    return TestClient(create_app(triposr_settings))


def _ready_diagnose(self):
    from app.adapters.base import ProviderStatus

    self._probe = {"ok": True, "cuda": False}
    return ProviderStatus("ready", details={"device": "cpu"})


def submit_triposr(client):
    return client.post("/v1/jobs", headers=AUTH, data={"type": "triposr", "params": '{"mcResolution": 128}'}, files={"image": ("i.png", png(64, 64), "image/png")})


def test_triposr_status_needs_repo_python_and_weights(tmp_path):
    st = TripoSRAdapter(make_settings(tmp_path, enable_triposr=True)).status()
    assert (st.status, st.code) == ("unavailable", "MODEL_NOT_CONFIGURED")


def test_triposr_job_returns_validated_mesh(triposr_client, monkeypatch):
    monkeypatch.setenv("FAKE_TRIPOSR_MODE", "ok")
    job = wait_job(triposr_client, submit_triposr(triposr_client).json()["id"])
    assert job["status"] == "ready", job
    assert job["result"]["faces"] == 12 and job["result"]["device"] == "cpu"
    assert job["result"]["timings_s"]["Running model"] == 1.23
    assert triposr_client.get(f"/v1/jobs/{job['id']}/artifacts/mesh.glb", headers=AUTH).content[:4] == b"glTF"


def test_triposr_failure_and_timeout(triposr_client, monkeypatch):
    monkeypatch.setenv("FAKE_TRIPOSR_MODE", "fail")
    job = wait_job(triposr_client, submit_triposr(triposr_client).json()["id"])
    assert job["status"] == "failed" and "exited with code 1" in job["error_message"]
    monkeypatch.setenv("FAKE_TRIPOSR_MODE", "slow")
    job = wait_job(triposr_client, submit_triposr(triposr_client).json()["id"], timeout=30)
    assert job["status"] == "failed" and "timed out" in job["error_message"]


def test_cancel_kills_running_process(triposr_client, monkeypatch):
    monkeypatch.setenv("FAKE_TRIPOSR_MODE", "slow")
    job_id = submit_triposr(triposr_client).json()["id"]
    for _ in range(100):
        if triposr_client.get(f"/v1/jobs/{job_id}", headers=AUTH).json()["status"] == "running":
            break
        time.sleep(0.05)
    start = time.time()
    triposr_client.post(f"/v1/jobs/{job_id}/cancel", headers=AUTH)
    job = wait_job(triposr_client, job_id, timeout=10)
    assert job["status"] == "cancelled"
    assert time.time() - start < 5
