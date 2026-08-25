from fastapi import APIRouter, Depends

from app.config import Settings, get_settings
from app.modules.agent.router import router as agent_router
from app.modules.scenes.router import router as scenes_router
from app.modules.skills.router import router as skills_router
from app.modules.traffic.router import router as traffic_router

router = APIRouter()

@router.get("/health")
def health(settings: Settings = Depends(get_settings)):
    return {
        "ok": True,
        "status": "ok",
        "data_mode": settings.data_mode,
        "contract_version": settings.contract_version,
    }


router.include_router(scenes_router)
router.include_router(traffic_router)
router.include_router(agent_router)
router.include_router(skills_router)
