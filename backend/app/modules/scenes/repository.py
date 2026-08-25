import json
from pathlib import Path

from app.modules.scenes.registry import DATASET_FILES
from app.shared.errors import ApiError


class FileSceneRepository:
    """只读 data/ 快照。禁止任意路径、禁止 .. 穿越。"""

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir.resolve()

    def load_dataset(self, name: str) -> dict:
        filename = DATASET_FILES.get(name)
        if not filename:
            raise ApiError("DATASET_NOT_ALLOWED", f"未知数据集: {name}", status_code=400)
        target = (self.data_dir / filename).resolve()
        if not str(target).startswith(str(self.data_dir)) or not target.is_file():
            raise ApiError("PATH_NOT_ALLOWED", f"数据集不可读: {name}", status_code=400)
        with target.open("r", encoding="utf-8") as fh:
            payload = json.load(fh)
        if not isinstance(payload, dict):
            raise ApiError("DATASET_NOT_ALLOWED", f"数据集不是对象: {name}", status_code=400)
        return payload
