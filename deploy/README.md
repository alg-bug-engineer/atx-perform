# 部署骨架

开发：

1. `conda activate daily && cd backend && uvicorn app.main:app --reload --port 8000`
2. `cd frontend && npm run dev`（5174，`/api/v1` 已代理到 8000）

生产示例见 `nginx.conf.example`：静态 `frontend/dist` + 反代 FastAPI。
