#!/usr/bin/env bash
# install.sh — YuE2-Workbench 一键安装
# 用法:
#   ./install.sh                 # 完整安装(环境检查 → venv → 依赖 → 前端构建)
#   ./install.sh --check         # 只做环境自检,不装任何东西
#   ./install.sh --models        # 完整安装后额外下载 7 个模型(约 15GB,需 HF 可达)
#   ./install.sh --mirror none   # pip 镜像:tsinghua(默认)| huawei | aliyun | none
#   ./install.sh --cpu           # 装 CPU 版 torch(无 NVIDIA 卡时)
#   ./install.sh --no-web        # 跳过前端安装与构建
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

MIRROR="tsinghua"
DO_CHECK=0
DO_MODELS=0
NO_WEB=0
CPU_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) DO_CHECK=1 ;;
    --models) DO_MODELS=1 ;;
    --no-web) NO_WEB=1 ;;
    --cpu) CPU_ONLY=1 ;;
    --mirror) MIRROR="${2:-}"; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
  shift
done

case "$MIRROR" in
  tsinghua) PIP_INDEX="https://pypi.tuna.tsinghua.edu.cn/simple" ;;
  huawei)   PIP_INDEX="https://mirrors.huaweicloud.com/repository/pypi/simple" ;;
  aliyun)   PIP_INDEX="https://mirrors.aliyun.com/pypi/simple" ;;
  none)     PIP_INDEX="" ;;
  *) echo "未知镜像: $MIRROR (tsinghua|huawei|aliyun|none)"; exit 1 ;;
esac
PIP_ARGS=()
[[ -n "$PIP_INDEX" ]] && PIP_ARGS=(--index-url "$PIP_INDEX")

PASS=0; FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
warn() { echo "  ! $1"; }
bad()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

section() { echo; echo "== $1 =="; }

# ---------- 环境自检 ----------
section "环境自检"

if command -v nvidia-smi >/dev/null 2>&1; then
  GPU=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -1)
  ok "GPU: ${GPU:-检测到 nvidia-smi}"
  [[ "$CPU_ONLY" == 1 ]] && warn "--cpu 已指定,将安装 CPU 版 torch"
else
  if [[ "$CPU_ONLY" == 1 ]]; then
    warn "未检测到 NVIDIA GPU,按 --cpu 继续(CPU 生成会非常慢)"
  else
    bad "未检测到 NVIDIA GPU(nvidia-smi 不存在)。无卡请加 --cpu 参数"
  fi
fi

PYBIN=""
for c in python3.12 python3.11 python3; do
  if command -v "$c" >/dev/null 2>&1; then
    V=$("$c" -c 'import sys;print("%d.%d"%sys.version_info[:2])' 2>/dev/null)
    MAJOR=$("$c" -c 'import sys;print(sys.version_info[0])')
    MINOR=$("$c" -c 'import sys;print(sys.version_info[1])')
    if [[ "$MAJOR" == 3 && "$MINOR" -ge 10 ]]; then PYBIN="$c"; ok "Python: $c ($V)"; break; fi
  fi
done
[[ -z "$PYBIN" ]] && bad "未找到 Python >= 3.10"

if command -v uv >/dev/null 2>&1; then
  ok "uv: $(uv --version 2>/dev/null | cut -d' ' -f2)"
  HAVE_UV=1
else
  warn "未安装 uv(推荐,装依赖快很多): curl -LsSf https://astral.sh/uv/install.sh | sh"
  HAVE_UV=0
fi

if command -v node >/dev/null 2>&1; then
  ok "Node: $(node --version)"
else
  if [[ "$NO_WEB" == 1 ]]; then warn "未找到 node(--no-web 模式跳过前端)"; else bad "未找到 node(>=18),前端构建需要: https://nodejs.org"; fi
fi

if command -v ffmpeg >/dev/null 2>&1; then
  ok "ffmpeg: $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f3)"
else
  bad "未找到 ffmpeg(分轨/音频解码需要): apt install ffmpeg 或 brew install ffmpeg"
fi

if [[ "$DO_CHECK" == 1 ]]; then
  echo; echo "自检完成: $PASS 通过, $FAIL 失败"
  [[ "$FAIL" -gt 0 ]] && echo "先解决上面的 ✗ 再运行 ./install.sh" || echo "可以运行 ./install.sh"
  exit $(( FAIL > 0 ? 1 : 0 ))
fi

[[ "$FAIL" -gt 0 ]] && { echo; echo "存在未满足的依赖,中止安装(或用 --check 查看)。"; exit 1; }

# ---------- Python 虚拟环境 ----------
section "Python 虚拟环境"
if [[ -x ".venv/bin/python" ]]; then
  ok ".venv 已存在,复用"
else
  if [[ "$HAVE_UV" == 1 ]]; then
    uv venv --python "$(command -v "$PYBIN")" .venv && ok "uv venv 创建完成"
  else
    "$PYBIN" -m venv .venv && ok "venv 创建完成"
  fi
fi
PY=".venv/bin/python"
PIP="$PY -m pip"
if ! $PIP --version >/dev/null 2>&1; then
  uv pip install --python "$PY" pip >/dev/null 2>&1 || "$PYBIN" -m pip install --upgrade pip >/dev/null
fi
_pip() { uv pip install --python "$PY" "${PIP_ARGS[@]}" "$@" || $PIP install "${PIP_ARGS[@]}" "$@"; }

# ---------- Python 依赖 ----------
section "Python 依赖(核心)"
_pip fastapi "uvicorn[standard]" sqlalchemy pydantic-settings python-dotenv
ok "Web 框架"

section "Python 依赖(torch)"
if [[ "$CPU_ONLY" == 1 ]]; then
  _pip torch torchvision torchaudio
else
  _pip torch torchvision torchaudio
fi
$PY - <<'EOF'
import torch
print(f"  ✓ torch {torch.__version__} | CUDA 可用: {torch.cuda.is_available()}"
      + (f" | {torch.cuda.get_device_name(0)}" if torch.cuda.is_available() else ""))
EOF

section "Python 依赖(模型栈)"
_pip "transformers==4.57.6" "huggingface-hub==0.36.2" "safetensors>=0.7" "tiktoken==0.12.0" "numpy==2.2.6" "soundfile==0.13.1" accelerate
ok "transformers / huggingface-hub / soundfile"

# yue2 wheel:优先本地找,找不到从 HF 下载
WHEEL="$(ls "$ROOT"/yue2_infer-*.whl "$ROOT"/../YuE2-Studio/yue2_infer-*.whl 2>/dev/null | sort -V | tail -1 || true)"
if [[ -z "$WHEEL" ]]; then
  echo "  … 本地未找到 yue2 wheel,从 HuggingFace 下载(约 1MB)"
  $PY - <<'EOF'
from huggingface_hub import hf_hub_download
p = hf_hub_download("m-a-p/YuE2-3B", "yue2_infer-0.1.5-py3-none-any.whl")
print(p)
EOF
  WHEEL="$($PY -c "from huggingface_hub import hf_hub_download;print(hf_hub_download('m-a-p/YuE2-3B','yue2_infer-0.1.5-py3-none-any.whl'))")"
fi
_pip --no-deps "$WHEEL"
ok "yue2-infer wheel: $(basename "$WHEEL")"

section "Python 依赖(扒谱 / 分轨 / ASR / Agent / 母带)"
_pip pretty_midi mido mir_eval scipy pedalboard
_pip qwen-asr
ok "SheetSage2 + Qwen3-ASR + 母带 DSP 依赖"
_pip --no-deps demucs julius lameenc openunmix dora-search
_pip tqdm pyyaml submitit omegaconf einops
ok "HTDemucs(demucs)依赖"
_pip huggingface-hub==0.36.2 --force-reinstall --no-deps 2>/dev/null || true
ok "固定 huggingface-hub 版本(yue2 要求 0.36.2)"
_pip verovio cairosvg pypdf
ok "乐谱 PDF 渲染(verovio + cairosvg + pypdf)"
_pip scikit-learn joblib
ok "MERT 探针打标(sklearn 逻辑回归头)"

$PY - <<'EOF'
mods = ["torch", "transformers", "yue2", "fastapi", "sqlalchemy", "soundfile",
        "pretty_midi", "demucs", "qwen_asr", "safetensors", "tiktoken"]
missing = []
for m in mods:
    try:
        __import__(m)
    except Exception as e:
        missing.append(f"{m} ({e})")
if missing:
    print("  ✗ 导入失败: " + ", ".join(missing)); raise SystemExit(1)
print("  ✓ 全部关键模块导入成功")
EOF

# ---------- 前端 ----------
if [[ "$NO_WEB" == 0 ]]; then
  section "前端(node_modules + 构建)"
  if command -v node >/dev/null 2>&1; then
    (cd web && npm install --no-audit --no-fund 2>&1 | tail -1)
    (cd web && npm run build 2>&1 | tail -2)
    ok "前端构建完成(web/dist)"
  else
    warn "跳过前端(无 node);后端启动后 / 将没有界面,只能调 API"
  fi
fi

# ---------- 模型下载(可选) ----------
if [[ "$DO_MODELS" == 1 ]]; then
  section "模型下载(约 15GB,HF 缓存)"
  for repo in m-a-p/YuE2-3B m-a-p/YuE2-Vae m-a-p/SheetSage2 m-a-p/MERT-v2-FullSong adefossez/HTDemucs-ft Qwen/Qwen3-ASR-0.6B Qwen/Qwen3-0.6B; do
    echo "  … $repo"
    $PY -c "from huggingface_hub import snapshot_download; snapshot_download('$repo', max_workers=4)" || warn "$repo 下载失败(可重跑本步骤续传)"
  done
  ok "模型就绪(HF 缓存)"
else
  echo
  echo "提醒:首次使用各功能时会自动从 HuggingFace 下载对应模型(共约 15GB)。"
  echo "      也可以现在一次性下载: ./install.sh --models"
fi

echo
echo "安装完成 ✔   启动: ./server.sh start   查看状态: ./server.sh status"
