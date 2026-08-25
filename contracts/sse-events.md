# Agent SSE 事件契约

`POST /api/v1/agent/run/stream` 返回 `text/event-stream`。前端消费见 `frontend/src/services/runtimeFixture.js`。

当前后端为占位模块（501 / 未实现流）。实现时必须输出下列事件，帧格式：

```
event: <name>
data: <json>

```

（事件块之间空一行。）

## 事件

| event | 何时 | data 必含 |
|-------|------|-----------|
| `phase_start` | 某阶段开始 | `trace_id`，`phase` 或 `skill_id` |
| `phase_done` | 某阶段结束 | `trace_id`，`phase` 或 `skill_id`，`success`，可选 `snapshot`、`errors` |
| `pipeline_complete` | 整链结束 | `trace_id`，`snapshot`，可选 `healthy` |
| `error` | 不可恢复失败 | `trace_id`，`reason` 或 `errors` |

## phase / skill_id

允许值（可互为别名）：`intent` / `intent_understanding`，`diagnosis` / `data_analysis_diagnosis`，`cause` / `cause_analysis`，`strategy` / `strategy_generation`，`plan` / `plan_generation`。

## snapshot 最低形状

```json
{
  "trace_id": "…",
  "healthy": false,
  "phases": {
    "intent": {},
    "diagnosis": { "metrics": {} },
    "cause": { "primary_cause": "" },
    "strategy": { "strategy_package": {} },
    "plan": {}
  }
}
```

`phase_done.success === false` 时前端不放行幕门控。Live 失败禁止静默回退 Demo fixture。
