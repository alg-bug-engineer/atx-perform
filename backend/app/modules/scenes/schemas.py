from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class SceneBundle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_key: Literal["0", "1", "2", "3", "4", "5"]
    source: Literal["demo", "live"]
    contract_version: str
    generated_at: datetime
    datasets: dict[str, dict[str, Any]]


class DatasetBundle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["demo", "live"]
    contract_version: str
    generated_at: datetime
    datasets: dict[str, dict[str, Any]]
