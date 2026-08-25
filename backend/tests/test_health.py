from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["status"] == "ok"
    assert body["data_mode"] == "demo"
    assert "X-Trace-Id" in res.headers


def test_live_placeholders_are_not_implemented():
    res = client.get("/api/v1/traffic/color-links")
    assert res.status_code == 501
    body = res.json()
    assert body["ok"] is False
    assert body["code"] == "NOT_IMPLEMENTED"
    assert body["trace_id"]
