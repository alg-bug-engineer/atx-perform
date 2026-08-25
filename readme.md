# atx-perform（济南交管支队信控智能体）

奥体西路晚高峰北向南排队溢出治理过程的可视化演绎（开幕 → 定位 → 成因 → 方案 → 评估 → 技能固化）。

## 文档

- `docs/storyline-requirements.md` — 剧本与工程约束
- `docs/data-contract.md` / `docs/data-sniff-report.md` — 数据契约与嗅探缺口
- `docs/baseline-project-analysis.md` — baseline 可视化资产分析

## 数据

幕数据：`data/1-*.json`（见嗅探报告）。排队长度固定专家值 **270 m**。

## 开发

- 前端：`cd frontend && npm run dev`（:5174）
- 后端：`conda activate daily && cd backend && uvicorn app.main:app --reload --port 8000`
- 契约：`contracts/`
- 功能在时间戳分支开发，禁止自动合入 `main`
- 配置：`cp env.example .env`（密钥勿入库）

前后端分离骨架：`backend/`（FastAPI）、`frontend/`（Vue）、`deploy/`。幕 JSON 默认仍打包进前端；设 `VITE_SCENE_API=1` 后改走 `/api/v1/scenes`。
