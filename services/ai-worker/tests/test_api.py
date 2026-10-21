from fastapi.testclient import TestClient

from app.main import create_app

from .conftest import AUTH, coloured_box, glb_bytes, make_settings, wait_job


def test_health_needs_no_auth(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_v1_requires_token(client, tmp_path):
    assert client.get("/v1/capabilities").status_code == 401
    assert client.get("/v1/capabilities", headers={"Authorization": "Bearer wrong"}).status_code == 401
    unset = TestClient(create_app(make_settings(tmp_path, ai_worker_token="")))
    assert unset.get("/v1/capabilities", headers=AUTH).status_code == 503


def test_capabilities_are_truthful_without_models(client):
    p = client.get("/v1/capabilities", headers=AUTH).json()["providers"]
    assert p["sking-v101c"]["status"] == "disabled"
    assert p["triposr"]["status"] == "disabled"
    assert p["mesh-cuboids-v1"]["status"] == "ready"
    assert p["trellis"]["status"] == "disabled"


def test_enabled_but_missing_models_report_unavailable(tmp_path):
    c = TestClient(create_app(make_settings(tmp_path, enable_sking=True, enable_triposr=True)))
    p = c.get("/v1/capabilities", headers=AUTH).json()["providers"]
    assert p["sking-v101c"]["status"] == "unavailable"
    assert p["sking-v101c"]["code"] == "MODEL_NOT_CONFIGURED"
    assert p["triposr"]["status"] == "unavailable"
    # refusing jobs uses the same truthful reason
    r = c.post("/v1/jobs", headers=AUTH, data={"type": "sking", "params": "{}"}, files={"composite": ("c.png", b"x", "image/png")})
    assert r.status_code == 503
    assert r.json()["error_code"] == "MODEL_NOT_CONFIGURED"
    # reasons never leak filesystem paths to the API/browser
    assert str(tmp_path) not in p["sking-v101c"]["reason"]


def test_unknown_job_type_and_missing_file(client):
    r = client.post("/v1/jobs", headers=AUTH, data={"type": "rm -rf", "params": "{}"})
    assert r.status_code == 400
    r = client.post("/v1/jobs", headers=AUTH, data={"type": "mesh_to_cuboids", "params": "{}"})
    assert r.status_code == 400


def test_mesh_to_cuboids_job_end_to_end(client):
    glb = glb_bytes(coloured_box((1, 2, 1), (0, 1, 0), (200, 30, 30)))
    r = client.post(
        "/v1/jobs",
        headers=AUTH,
        data={"type": "mesh_to_cuboids", "params": '{"resolution": "low", "maxCubes": 50}'},
        files={"mesh": ("mesh.glb", glb, "application/octet-stream")},
    )
    assert r.status_code == 202, r.text
    job = wait_job(client, r.json()["id"])
    assert job["status"] == "ready", job
    assert job["artifacts"] == ["cuboids.json"]
    out = client.get(f"/v1/jobs/{job['id']}/artifacts/cuboids.json", headers=AUTH).json()
    assert len(out["cubes"]) == 1
    assert out["cubes"][0]["color"] == "#c81e1e"
    assert client.get(f"/v1/jobs/{job['id']}/artifacts/../../etc/passwd", headers=AUTH).status_code == 404


def test_bad_mesh_fails_cleanly(client):
    r = client.post(
        "/v1/jobs",
        headers=AUTH,
        data={"type": "mesh_to_cuboids", "params": "{}"},
        files={"mesh": ("mesh.glb", b"glTF-but-not-really", "application/octet-stream")},
    )
    job = wait_job(client, r.json()["id"])
    assert job["status"] == "failed"
    assert job["error_code"] == "BAD_REQUEST"
