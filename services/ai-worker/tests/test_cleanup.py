from fastapi.testclient import TestClient

from app.jobs import JobRegistry
from app.main import create_app
from .conftest import AUTH, make_settings


def test_delete_removes_worker_input_output_and_job(tmp_path):
    settings = make_settings(tmp_path)
    with TestClient(create_app(settings)) as client:
        registry = client.app.state.registry
        job = registry.submit('test', {}, {'private.png': b'private input'}, lambda ctx: {'ok': True})
        registry.pool.shutdown(wait=True)
        assert job.dir.exists()
        response = client.delete(f'/v1/jobs/{job.id}', headers=AUTH)
        assert response.status_code == 200
        assert not job.dir.exists()
        assert registry.get(job.id) is None
        assert client.get(f'/v1/jobs/{job.id}', headers=AUTH).status_code == 404


def test_restart_sweeps_old_orphaned_scratch(tmp_path):
    import os
    stale = tmp_path / 'jobs' / 'orphan'
    stale.mkdir(parents=True)
    (stale / 'photo.png').write_bytes(b'private')
    os.utime(stale, (1, 1))
    registry = JobRegistry(tmp_path, max_workers=1, ttl_s=10)
    try:
        assert not stale.exists()
    finally:
        registry.close()
