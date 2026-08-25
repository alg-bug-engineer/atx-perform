from pathlib import Path

import pytest

from app.modules.scenes.repository import FileSceneRepository
from app.shared.errors import ApiError


def test_unknown_dataset_rejected(tmp_path: Path):
    repo = FileSceneRepository(tmp_path)
    with pytest.raises(ApiError) as exc:
        repo.load_dataset("not-a-dataset")
    assert exc.value.code == "DATASET_NOT_ALLOWED"


def test_missing_file_rejected(tmp_path: Path):
    repo = FileSceneRepository(tmp_path)
    with pytest.raises(ApiError) as exc:
        repo.load_dataset("locate")
    assert exc.value.code == "PATH_NOT_ALLOWED"
