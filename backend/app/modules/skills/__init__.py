"""技能固化。把 frontend/plugins/skillSolidifyPlugin.js 的校验/签名/幂等迁到这里。"""

from app.shared.errors import not_implemented


class SkillService:
    def solidify(self, _payload: dict):
        raise not_implemented("skills")
