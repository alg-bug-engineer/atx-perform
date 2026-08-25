from typing import Any

from fastapi import APIRouter

from app.modules.traffic import TrafficService

router = APIRouter(tags=["traffic"])


@router.post("/intersection/load")
def intersection_load(payload: dict[str, Any]):
    return TrafficService().load_intersection(payload)


@router.get("/traffic/color-links")
def traffic_color_links():
    return TrafficService().color_links()
