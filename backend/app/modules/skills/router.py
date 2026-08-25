from typing import Any

from fastapi import APIRouter

from app.modules.skills import SkillService

router = APIRouter(prefix="/agent/skill", tags=["skills"])


@router.post("/solidify")
def solidify_skill(payload: dict[str, Any]):
    return SkillService().solidify(payload)
