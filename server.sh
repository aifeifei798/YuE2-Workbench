#!/usr/bin/env bash
# server.sh — YuE2-Workbench 服务管理
# 用法:
#   ./server.sh start [port]   后台启动(默认 8000),等待健康检查通过
#   ./server.sh stop           停止
#   ./server.sh restart [port] 重启
#   ./server.sh status         运行状态 + 模型驻留 + 显存 + 队列
#   ./server.sh health         一次性健康检查(脚本可用的退出码)
#   ./server.sh logs [n]       查看最近日志(默认 50 行,加 -f 跟随: ./server.sh logs -f)
#   ./server.sh dev            开发模式:后端 --reload + Vite 5173(前台)
#   ./server.sh build          构建前端
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PID_FILE="$ROOT/.server.pid"
LOG_FILE="$ROOT/.server.log"
PORT_FILE="$ROOT/.server.port"
PY="$ROOT/.venv/bin/python"
PORT="8000"
CMD="${1:-status}"

_curl() { curl -s --noproxy '*' -m "$1" "${2}" 2>/dev/null || true; }

_health() { _curl 3 "http://127.0.0.1:${PORT}/api/healthz"; }

_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid; pid=$(cat "$PID_FILE" 2>/dev/null || true)
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

_port_busy() { _curl 2 "http://127.0.0.1:${PORT}/api/healthz" | grep -q '"status"'; }

load_port() { [[ -f "$PORT_FILE" ]] && PORT=$(cat "$PORT_FILE"); return 0; }

do_start() {
  if _running; then
    load_port
    echo "已在运行 (pid $(cat "$PID_FILE"), 端口 $PORT)。restart 可重启。"
    return 0
  fi
  if _port_busy; then
    echo "端口 $PORT 已被其它进程占用(可能是残留服务)。请 ./server.sh stop 或换端口: ./server.sh start 8001"
    exit 1
  fi
  [[ -x "$PY" ]] || { echo "找不到 $PY — 先运行 ./install.sh"; exit 1; }
  # .env 里的 HF_HUB_OFFLINE 等变量要进环境:huggingface_hub 读的是 os.environ
  if [[ -f "$ROOT/.env" ]]; then set -a; . "$ROOT/.env" 2>/dev/null; set +a; fi
  : > "$LOG_FILE"
  nohup "$PY" -m uvicorn backend.app.main:app --host 0.0.0.0 --port "$PORT" --workers 1 >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  echo "$PORT" > "$PORT_FILE"
  echo "启动中 (pid $(cat "$PID_FILE"), 端口 $PORT)…"
  for _ in $(seq 1 30); do
    sleep 1
    if _health | grep -q '"status":"ok"'; then
      echo "服务就绪 ✔  http://127.0.0.1:$PORT"
      _health | python3 -c "import json,sys;d=json.load(sys.stdin);g=d['models'].get('gpu');print('  模型均已卸载,首次使用自动加载' if not any(v.get('loaded') for k,v in d['models'].items() if isinstance(v,dict)) else '  有模型驻留');print(f\"  显存 {g['free_gb']}/{g['total_gb']} GB\" if g else '')" 2>/dev/null || true
      return 0
    fi
    if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "启动失败,最近日志:"; tail -15 "$LOG_FILE"; exit 1
    fi
  done
  echo "30s 内未就绪(模型加载或依赖问题),查看日志: ./server.sh logs"
  exit 1
}

do_stop() {
  if ! _running; then
    rm -f "$PID_FILE"
    echo "未在运行。"
    exit 0
  fi
  local pid; pid=$(cat "$PID_FILE")
  echo "停止 (pid $pid)…"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 15); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "强制终止…"; kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  echo "已停止 ✔"
}

do_status() {
  echo "== YuE2-Workbench =="
  if _running; then
    load_port
    echo "  进程: 运行中 (pid $(cat "$PID_FILE"), 端口 $PORT)"
  else
    echo "  进程: 未运行(start 启动 / install.sh 安装)"
  fi
  local h; h=$(_health)
  if [[ -n "$h" ]]; then
    echo "$h" | python3 -c "
import json,sys
d=json.load(sys.stdin)
m=d['models']
g=m.pop('gpu', None)
for k,v in m.items():
    if isinstance(v,dict):
        print(f\"  {k:10s} {'● 驻留' if v.get('loaded') else '○ 未加载'}\")
if g: print(f\"  GPU {g['name']} | 显存 {g['free_gb']}/{g['total_gb']} GB\")
print(f\"  队列深度 {d['queue']['depth']}\")
" 2>/dev/null || echo "  healthz 返回异常: $h"
  else
    echo "  服务无响应(未运行或端口不一致;若手动改过端口,先 stop 再 start)"
  fi
}

do_health() { _health | grep -q '"status":"ok"' && { echo "ok"; exit 0; } || { echo "unhealthy"; exit 1; }; }

do_logs() {
  [[ -f "$LOG_FILE" ]] || { echo "暂无日志"; exit 0; }
  if [[ "${1:-}" == "-f" ]]; then tail -f "$LOG_FILE"; else tail -n "${1:-50}" "$LOG_FILE"; fi
}

case "$CMD" in
  start)   PORT="${2:-8000}"; do_start ;;
  stop)    do_stop ;;
  restart) load_port; PORT="${2:-$PORT}"; do_stop; sleep 1; do_start ;;
  status)  load_port; do_status ;;
  health)  load_port; do_health ;;
  logs)    shift || true; do_logs "$@" ;;
  build)   (cd web && npm run build) ;;
  dev)     if [[ -f "$ROOT/.env" ]]; then set -a; . "$ROOT/.env" 2>/dev/null; set +a; fi; "$PY" -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload & BACK=$!; trap 'kill $BACK 2>/dev/null || true' EXIT; (cd web && npm run dev) ;;
  install) exec ./install.sh ;;
  -h|--help|help) sed -n '2,12p' "$0" ;;
  *) echo "未知命令: $1"; sed -n '2,12p' "$0"; exit 1 ;;
esac
