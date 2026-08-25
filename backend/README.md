# atx-perform API

FastAPI 独立进程。Demo 轨读取仓库 `data/1-*.json`；Live 轨（PG / Agent / 技能）为模块占位。

## 启动

```bash
cd backend
uv sync --all-extras                              # 首次：创建 .venv 并安装依赖
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

> 依赖由 uv 管理（Python >=3.11，uv 自动安装匹配版本）；无需 conda。
> 跑测试：`uv run pytest -q`。

- 健康检查：http://127.0.0.1:8000/api/v1/health
- OpenAPI：http://127.0.0.1:8000/docs
- 契约真源：仓库 `contracts/`

前端开发：`cd frontend && npm run dev`（Vite 已把 `/api/v1` 代理到本服务）。

## 模块归属

| 目录 | 职责 | 状态 |
|------|------|------|
| `app/modules/scenes/` | 幕 JSON 读取 | Demo 已通 |
| `app/modules/traffic/` | 路口预载、路况着色 | 占位 |
| `app/modules/agent/` | 推演、SSE、方案决策 | 占位 |
| `app/modules/skills/` | 技能固化落盘 | 占位 |

配置：复制 `backend/.env.example` 为仓库根 `.env` 或 `backend/.env`。
