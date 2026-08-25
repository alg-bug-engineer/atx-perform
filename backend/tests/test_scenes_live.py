"""Live 轨幕2 测试：需真实 PG 可达（121.40.233.80）。Demo 环境跳过。"""
import os

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("DATA_MODE") != "live", reason="需 DATA_MODE=live + 真实 PG"
)

from app.config import get_settings  # noqa: E402
from app.modules.scenes.service import SceneService  # noqa: E402


@pytest.fixture()
def svc():
    get_settings.cache_clear()
    return SceneService(get_settings())


def test_live_scene2_default_topology(svc):
    r = svc.get_scene("2")
    ft = r["datasets"]["flowTrace"]
    assert ft["target"]["id"] == "011wwe28ctu00001"  # 经十
    assert ft["via"]["id"] == "011wwe28fmc00001"  # 解放东
    assert ft["source"]["id"]  # 上游为 PG 拓扑推导（非空即可）


def test_live_scene2_paired_params(svc):
    r = svc.get_scene(
        "2",
        target_inter_id="011wwe28fmc00001",
        link_id="12wwe28ftwwe28fm01",  # 坤顺→解放东
    )
    ft = r["datasets"]["flowTrace"]
    obj = r["datasets"]["objects"]
    assert ft["target"]["id"] == "011wwe28fmc00001"
    assert ft["via"]["id"] == "011wwe28fty00001"  # 由 link.f 推导
    assert obj["problem_link"]["length_m"] == 215.68


def test_live_scene2_default_share_from_trace_table(svc):
    """默认参数：via/source 由关联表 chain_hop 分层推导，占比为真实值。"""
    r = svc.get_scene("2")
    ft = r["datasets"]["flowTrace"]
    # via 应为关联表 hop=1 最高占比（解放东），且 via_ratio 为真实占比（非 mock）
    assert ft["via"]["id"] == "011wwe28fmc00001"
    assert ft["upstream_share_display"]["via_ratio"] is not None


def test_live_scene2_direction_movement(svc):
    """direction/movement 参数生效：北向南直行 → dir8=0 turn=2。"""
    r = svc.get_scene("2", direction="北向南", movement="直行")
    ft = r["datasets"]["flowTrace"]
    assert ft["via"]["id"] == "011wwe28fmc00001"  # 北进口直行 hop=1 最高 = 解放东
