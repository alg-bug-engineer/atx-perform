from fastapi import APIRouter, Depends, Query

from app.config import Settings, get_settings
from app.modules.scenes.schemas import DatasetBundle, SceneBundle
from app.modules.scenes.service import SceneService

router = APIRouter(prefix="/scenes", tags=["scenes"])


def get_scene_service(settings: Settings = Depends(get_settings)) -> SceneService:
    return SceneService(settings)


@router.get("/bundle", response_model=DatasetBundle)
def scene_bundle(
    names: str,
    service: SceneService = Depends(get_scene_service),
):
    parsed = [item.strip() for item in names.split(",") if item.strip()]
    return service.get_bundle(parsed)


@router.get("/{scene_key}", response_model=SceneBundle)
def scene_by_key(
    scene_key: str,
    target_inter_id: str | None = Query(
        default=None, description="幕2溯源汇点路口ID，默认011wwe28ctu00001"
    ),
    link_id: str | None = Query(
        default=None, description="幕2问题路段ID，默认12wwe28fmwwe28ct01，优先于关联表推导 via"
    ),
    direction: str | None = Query(default=None, description="问题主流向 北向南/南向北/东向西/西向东，默认北向南"),
    movement: str | None = Query(default=None, description="转向 直行/左转/右转，默认直行"),
    day_of_week: int | None = Query(default=None, description="周型，默认1"),
    step_start: int | None = Query(default=None, description="起始5分钟步序号，默认210"),
    step_end: int | None = Query(default=None, description="结束步序号，默认221"),
    trace_type: str | None = Query(default=None, description="溯源方向 upstream/downstream，默认upstream"),
    max_hop: int | None = Query(default=None, description="最大追溯跳数1-3，默认3"),
    service: SceneService = Depends(get_scene_service),
):
    return service.get_scene(
        scene_key,
        target_inter_id=target_inter_id,
        link_id=link_id,
        direction=direction,
        movement=movement,
        day_of_week=day_of_week,
        step_start=step_start,
        step_end=step_end,
        trace_type=trace_type,
        max_hop=max_hop,
    )
