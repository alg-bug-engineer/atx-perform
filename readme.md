# atx-perform（奥体西绩效可视化）

奥体西路晚高峰北向南排队溢出治理过程的可视化演绎（开幕 → 定位 → 成因 → 方案 → 评估 → 技能固化）。

## 文档

- `docs/storyline-requirements.md` — 剧本与工程约束
- `docs/data-contract.md` / `docs/data-sniff-report.md` — 数据契约与嗅探缺口
- `docs/baseline-project-analysis.md` — baseline 可视化资产分析

## 数据

幕数据：`data/1-*.json`（见嗅探报告）。排队长度固定专家值 **270 m**。

## 开发

- UI 风格对齐 `references/baseline`
- 功能在时间戳分支开发，禁止自动合入 `main`
- 配置：`cp env.example .env`
