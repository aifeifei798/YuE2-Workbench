#!/usr/bin/env bash
# YuE2-Workbench 启动脚本
#   ./server.sh            前台启动(后端 8000,前端 dist 已构建则同服)
#   ./server.sh dev        开发模式(后端 8000 + Vite 5173 热更新)
#   ./server.sh build      构建前端
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

PY=.venv/bin/python

case "${1:-start}" in
  build)
    (cd web && npm run build)
    ;;
  dev)
    "$PY" -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 &
    BACK=$!
    trap 'kill $BACK 2>/dev/null || true' EXIT
    (cd web && npm run dev)
    ;;
  start|*)
    exec "$PY" -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --workers 1
    ;;
esac
