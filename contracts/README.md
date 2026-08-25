# API 契约

本目录是前后端的唯一接口真源。改字段先改这里，再改 `backend/` 与 `frontend/`。

| 文件 | 内容 |
|------|------|
| `openapi.yaml` | HTTP `/api/v1` |
| `sse-events.md` | Agent SSE 事件 |
| `schemas/error.json` | 统一错误体 |
| `schemas/scene-bundle.json` | 幕数据包 |

约定：网络字段 `snake_case`；距离用米；错误体含 `ok/code/reason/trace_id`。
