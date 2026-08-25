from datetime import datetime, timezone

from app.config import Settings
from app.modules.scenes.registry import SCENE_DATASETS
from app.modules.scenes.repository import FileSceneRepository
from app.shared.errors import ApiError


class SceneService:
    def __init__(self, settings: Settings, repo: FileSceneRepository | None = None):
        self.settings = settings
        self.repo = repo or FileSceneRepository(settings.resolved_data_dir)

    def get_scene(self, scene_key: str) -> dict:
        names = SCENE_DATASETS.get(scene_key)
        if not names:
            raise ApiError("SCENE_NOT_FOUND", f"未知幕: {scene_key}", status_code=404)
        return {
            "scene_key": scene_key,
            "source": self.settings.data_mode,
            "contract_version": self.settings.contract_version,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "datasets": {name: self.repo.load_dataset(name) for name in names},
        }

    def get_bundle(self, names: list[str]) -> dict:
        if not names:
            raise ApiError("DATASET_NOT_ALLOWED", "缺少 names", status_code=400)
        return {
            "source": self.settings.data_mode,
            "contract_version": self.settings.contract_version,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "datasets": {name: self.repo.load_dataset(name) for name in names},
        }
