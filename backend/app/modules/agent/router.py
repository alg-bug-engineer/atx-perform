from typing import Any

from fastapi import APIRouter

from app.modules.agent import AgentService

router = APIRouter(tags=["agent"])


@router.post("/agent/run")
def agent_run(payload: dict[str, Any]):
    return AgentService().run(payload)


@router.post("/agent/run/stream")
def agent_run_stream(payload: dict[str, Any]):
    return AgentService().run_stream(payload)


@router.post("/agent/plan/decision")
def agent_plan_decision(payload: dict[str, Any]):
    return AgentService().decide_plan(payload)


@router.post("/agent/plan/regenerate")
def agent_plan_regenerate(payload: dict[str, Any]):
    return AgentService().regenerate_plan(payload)


@router.post("/voice/brief")
def voice_brief(payload: dict[str, Any]):
    return AgentService().voice_brief(payload)
