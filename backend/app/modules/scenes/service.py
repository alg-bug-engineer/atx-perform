"""幕数据服务。

Demo 轨：FileSceneRepository 读 data/*.json。
Live 轨：PgSceneRepository 从 PG 读几何/指标，叙事文案按 narration_mode 补齐：
  - 0 = 纯 PG（只返回库内字段，文案缺失）
  - 1 = 混合（PG 数值覆盖 data/*.json 固化文案，推荐，前端渲染完整）
  - 2 = LLM 实时生成（未实现，抛 NOT_IMPLEMENTED）
"""

from datetime import datetime, timezone

from app.config import Settings
from app.modules.scenes.pg_repository import PgSceneRepository
from app.modules.scenes.registry import SCENE_DATASETS
from app.modules.scenes.repository import FileSceneRepository
from app.shared.errors import ApiError, not_implemented


def _deep_merge(base: dict, override: dict) -> dict:
    """递归合并：override 覆盖 base 同名字段；override 值为 None 时不覆盖（保留固化兜底）。"""
    if not isinstance(base, dict) or not isinstance(override, dict):
        return override if override is not None else base
    result = dict(base)
    for key, value in override.items():
        if value is None:
            continue
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


class SceneService:
    def __init__(
        self,
        settings: Settings,
        repo: FileSceneRepository | None = None,
        pg_repo: PgSceneRepository | None = None,
    ):
        self.settings = settings
        self.repo = repo or FileSceneRepository(settings.resolved_data_dir)
        self.pg_repo = pg_repo or PgSceneRepository(settings)

    def get_scene(
        self,
        scene_key: str,
        *,
        target_inter_id: str | None = None,
        link_id: str | None = None,
        direction: str | None = None,
        movement: str | None = None,
        day_of_week: int | None = None,
        step_start: int | None = None,
        step_end: int | None = None,
        trace_type: str | None = None,
        max_hop: int | None = None,
    ) -> dict:
        names = SCENE_DATASETS.get(scene_key)
        if not names:
            raise ApiError("SCENE_NOT_FOUND", f"未知幕: {scene_key}", status_code=404)
        self._validate_params(direction, movement, trace_type, max_hop, step_start, step_end)

        datasets = self._load_datasets(
            scene_key,
            names,
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
        return {
            "scene_key": scene_key,
            "source": self.settings.data_mode,
            "contract_version": self.settings.contract_version,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "datasets": datasets,
        }

    @staticmethod
    def _validate_params(
        direction: str | None,
        movement: str | None,
        trace_type: str | None,
        max_hop: int | None,
        step_start: int | None,
        step_end: int | None,
    ) -> None:
        """入参范围校验：非法值返回 400，避免静默查空。"""
        if direction is not None and direction.strip() not in (
            "北向南", "南向北", "东向西", "西向东", "北", "南", "东", "西",
        ):
            raise ApiError(
                "DIRECTION_INVALID",
                f"direction 仅支持 北向南/南向北/东向西/西向东，收到: {direction}",
                status_code=400,
            )
        if movement is not None and movement.strip() not in ("直行", "左转", "右转"):
            raise ApiError(
                "MOVEMENT_INVALID",
                f"movement 仅支持 直行/左转/右转，收到: {movement}",
                status_code=400,
            )
        if trace_type is not None and trace_type.strip().lower() not in ("upstream", "downstream"):
            raise ApiError(
                "TRACE_TYPE_INVALID",
                f"trace_type 仅支持 upstream/downstream，收到: {trace_type}",
                status_code=400,
            )
        if max_hop is not None and not 1 <= max_hop <= 3:
            raise ApiError(
                "MAX_HOP_INVALID",
                f"max_hop 仅支持 1-3，收到: {max_hop}",
                status_code=400,
            )
        if step_start is not None and step_end is not None and step_start > step_end:
            raise ApiError(
                "TIME_WINDOW_INVALID",
                f"step_start({step_start}) 不能大于 step_end({step_end})",
                status_code=400,
            )

    def get_bundle(self, names: list[str]) -> dict:
        if not names:
            raise ApiError("DATASET_NOT_ALLOWED", "缺少 names", status_code=400)
        return {
            "source": self.settings.data_mode,
            "contract_version": self.settings.contract_version,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "datasets": {name: self.repo.load_dataset(name) for name in names},
        }

    def _load_datasets(
        self,
        scene_key: str,
        names: list[str],
        *,
        target_inter_id: str | None = None,
        link_id: str | None = None,
        direction: str | None = None,
        movement: str | None = None,
        day_of_week: int | None = None,
        step_start: int | None = None,
        step_end: int | None = None,
        trace_type: str | None = None,
        max_hop: int | None = None,
    ) -> dict:
        """Live 模式仅幕 2（分析成因）接 PG；其余幕暂保持 Demo 读文件。"""
        if self.settings.data_mode != "live" or scene_key != "2":
            return {name: self.repo.load_dataset(name) for name in names}
        return self._load_scene2_live(
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

    def _load_scene2_live(
        self,
        *,
        target_inter_id: str | None = None,
        link_id: str | None = None,
        direction: str | None = None,
        movement: str | None = None,
        day_of_week: int | None = None,
        step_start: int | None = None,
        step_end: int | None = None,
        trace_type: str | None = None,
        max_hop: int | None = None,
    ) -> dict:
        try:
            pg_data = self.pg_repo.load_scene2(
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
        except Exception as exc:  # noqa: BLE001 - PG 抖动/不可达时统一降级
            if self.settings.allow_demo_fallback:
                return {
                    "objects": self.repo.load_dataset("objects"),
                    "flowTrace": self.repo.load_dataset("flowTrace"),
                    "cause": self.repo.load_dataset("cause"),
                }
            raise ApiError(
                "PG_UNAVAILABLE",
                f"PG 读取失败: {str(exc)[:200]}",
                status_code=503,
            )
        mode = self.settings.narration_mode

        if mode == 0:
            # 纯 PG：只返回库内可查字段
            return pg_data

        if mode == 1:
            # 混合：data/*.json 基底 + PG 数值覆盖（None 不覆盖，保留固化兜底）
            base = {
                "objects": self.repo.load_dataset("objects"),
                "flowTrace": self.repo.load_dataset("flowTrace"),
                "cause": self.repo.load_dataset("cause"),
            }
            return {
                "objects": _deep_merge(base["objects"], pg_data["objects"]),
                "flowTrace": _deep_merge(base["flowTrace"], pg_data["flowTrace"]),
                "cause": _deep_merge(base["cause"], pg_data["cause"]),
            }

        if mode == 2:
            raise not_implemented("narration_mode=2（LLM 文案生成）")

        raise ApiError(
            "NARRATION_MODE_INVALID",
            f"narration_mode 仅支持 0/1/2，收到: {mode}",
            status_code=400,
        )
