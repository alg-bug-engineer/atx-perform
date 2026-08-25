from fastapi.testclient import TestClient

from app.main import app
from app.modules.scenes.registry import SCENE_DATASETS

client = TestClient(app)


def test_scene_0_datasets():
    res = client.get("/api/v1/scenes/0")
    assert res.status_code == 200
    body = res.json()
    assert body["scene_key"] == "0"
    assert set(body["datasets"]) == set(SCENE_DATASETS["0"])
    assert body["datasets"]["objects"]["problem_link"]["link_id"] == "12wwe28fmwwe28ct01"


def test_scene_1_datasets():
    res = client.get("/api/v1/scenes/1")
    assert res.status_code == 200
    body = res.json()
    assert body["scene_key"] == "1"
    assert body["source"] == "demo"
    assert set(body["datasets"]) == set(SCENE_DATASETS["1"])
    objects = body["datasets"]["objects"]
    assert objects["problem_link"]["link_id"] == "12wwe28fmwwe28ct01"


def test_scene_2_datasets():
    res = client.get("/api/v1/scenes/2")
    assert res.status_code == 200
    body = res.json()
    assert set(body["datasets"]) == set(SCENE_DATASETS["2"])
    assert "upstream_traces" in body["datasets"]["cause"] or "actions" in body["datasets"]["flowTrace"]


def test_unknown_scene():
    res = client.get("/api/v1/scenes/9")
    assert res.status_code == 404
    assert res.json()["code"] == "SCENE_NOT_FOUND"


def test_bundle_and_path_safety():
    ok = client.get("/api/v1/scenes/bundle", params={"names": "locate,channelization"})
    assert ok.status_code == 200
    assert set(ok.json()["datasets"]) == {"locate", "channelization"}

    bad = client.get("/api/v1/scenes/bundle", params={"names": "../secret"})
    assert bad.status_code == 400
    assert bad.json()["code"] == "DATASET_NOT_ALLOWED"
