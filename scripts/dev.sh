#!/usr/bin/env bash
#
# 一条命令同时拉起前后端（开发环境）：
#   后端  FastAPI  -> http://127.0.0.1:8000   （uv run uvicorn --reload）
#   前端  Vite     -> http://localhost:5174   （npm run dev，VITE_SCENE_API=1 走联调）
#
# 用法：
#   npm run dev          # 前后端一起起
#   bash scripts/dev.sh  # 等价
#
# Ctrl+C 同时停止前后端。
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo ""
  echo "[dev] 停止前后端..."
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[dev] 启动后端  http://127.0.0.1:8000 ..."
(
  cd "$ROOT/backend"
  uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
) &
BACKEND_PID=$!

echo "[dev] 启动前端  http://localhost:5174 ..."
(
  cd "$ROOT/frontend"
  # VITE_SCENE_API=1：幕数据走 GET /api/v1/scenes/{key}（联调后端）。
  # 去掉该变量则为纯静态演示（走 @data 打包，不依赖后端）。
  VITE_SCENE_API=1 npm run dev
) &
FRONTEND_PID=$!

wait
