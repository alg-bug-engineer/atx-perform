# 后端模块开发边界

模块内自行维护 `router.py`、`service.py`、`repository.py`、`schemas.py` 和测试；
`app/api/v1/router.py` 只负责挂载模块路由，避免多人同时修改同一个总路由。

| 模块 | API | 建议负责人 |
|------|-----|------------|
| `scenes/` | `/scenes/*`，幕 0–2 Demo 数据已实现 | 前三幕数据 |
| `traffic/` | `/intersection/load`、`/traffic/color-links` | PG/交通指标 |
| `agent/` | `/agent/run*`、方案决策、口播 | Agent/SSE |
| `skills/` | `/agent/skill/solidify` | 技能固化 |

新增字段先更新仓库 `contracts/`，再修改 Pydantic 模型和前端 gateway。
