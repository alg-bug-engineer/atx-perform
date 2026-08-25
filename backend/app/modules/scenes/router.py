from fastapi import APIRouter, Depends

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
    service: SceneService = Depends(get_scene_service),
):
    return service.get_scene(scene_key)
