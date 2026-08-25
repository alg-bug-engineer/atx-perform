"""Agent 推演与 SSE（Live）。实现时对齐 contracts/sse-events.md。"""

from app.shared.errors import not_implemented


class AgentService:
    def run(self, _payload: dict):
        raise not_implemented("agent")

    def run_stream(self, _payload: dict):
        raise not_implemented("agent")

    def decide_plan(self, _payload: dict):
        raise not_implemented("agent")

    def regenerate_plan(self, _payload: dict):
        raise not_implemented("agent")

    def voice_brief(self, _payload: dict):
        raise not_implemented("agent")
