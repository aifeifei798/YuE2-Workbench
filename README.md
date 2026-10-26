# YuE2-Workbench

整合式 AI 音乐工作台:AI 唱作 / 翻唱重制 / Agent 改谱 / 自动扒谱 / 音乐库理解 / 质量评测,内含乐谱驱动 DAW 工作区。

- 总体规划与技术选型:[docs/PLAN.md](docs/PLAN.md)
- API 设计:[docs/API.md](docs/API.md)

技术栈:FastAPI(单卡单进程 GPU 队列) + SQLite + Vite/React/TS + Tailwind CSS v4 + shadcn/ui + wavesurfer.js + abcjs。

模型(本地 HF 缓存直连):m-a-p/YuE2-3B、m-a-p/YuE2-Vae、m-a-p/SheetSage2、m-a-p/MERT-v2-30s / FullSong、adefossez/HTDemucs-ft、Qwen/Qwen3-ASR-0.6B。

> 状态:**P0-P5 全部完成 + 四项增强已落地**。平台功能:AI 唱作、自动扒谱、分轨、音乐库(相似/歌单/启发式情绪能量标签+筛选)、翻唱重制、DAW 工作区(区域试听/小节线对齐挖补/尾段重唱/改谱重渲染/改词重唱/A-B 对比)、AI 改谱(工具化 Agent)、自动评测、本地排行榜。
> 许可提醒:所涉模型权重均为 CC BY-NC 4.0,仅限非商用。

---

## 快速开始(当前状态:P0+P1 已跑通)

```bash
# 1) 环境(已有 .venv:torch 2.11.0+cu130 / transformers 4.57.6 / yue2-infer 0.1.6)
#    缺依赖时:
uv pip install --python .venv/bin/python fastapi "uvicorn[standard]" sqlalchemy pydantic-settings \
  transformers==4.57.6 huggingface-hub==0.36.2 tiktoken soundfile accelerate \
  pretty_midi mido mir_eval scipy
uv pip install --python .venv/bin/python --no-deps YuE2-Studio/yue2_infer-0.1.6-py3-none-any.whl

# 2) 前端构建(或 ./server.sh build)
cd web && npm install && npm run build && cd ..

# 3) 启动(前端 dist 由后端同服,打开 http://127.0.0.1:8000)
./server.sh
# 开发热更新模式:./server.sh dev (后端 8000 + Vite 5173)

# 4) 冒烟
.venv/bin/python smoke/smoke_all.py
```

冒烟结果(2026-10-27,RTX 5090 D):YuE2 加载 9.4s / 39s 歌曲生成 13.3s;SheetSage2 加载 22.2s / 转录 5.0s(全工件:ABC/MIDI/LAB/PDF);MERT 提特征 2.8s;VAE 解码 1.0s。
注意:SheetSage2 固定父模型 MERT-v2-FullSong 的特定 revision(自动联网校验,勿开 HF_HUB_OFFLINE=1 跑它)。
