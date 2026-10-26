# YuE2-Workbench 项目规划

> 整合式 AI 音乐工作台:唱作 / 翻唱 / Agent 编辑 / 扒谱 / 音乐库理解 / 质量评测,乐谱驱动 DAW 是其中的核心编辑体验。
> 本文档是项目总纲,实施以分期路线图推进,每期有明确验收标准。

## 1. 定位与原则

- **整合优先**:能复用的绝不重写。YuE2-Studio 的后端骨架(队列/鉴权/历史/部署)与前端组件(波形/Admin)直接移植;模型推理一律走 `yue2` 官方 wheel 与 `trust_remote_code` 官方实现。
- **乐谱驱动**:所有"编辑"都落在 ABC 谱 / 歌词 / 和弦 / 风格上,由模型重渲染;音频层只做裁剪试听、分轨显示与挖补拼接,不做手画波形。
- **单机单卡**:面向本地 1×GPU(RTX 5090 32GB)单用户工作台设计,不做分布式;前后端分离,可 docker 部署。

## 2. 技术栈(已定)

| 层 | 选型 | 理由 |
|---|---|---|
| 后端 | Python 3.11+ / FastAPI / Pydantic v2 / uvicorn(`--workers 1`) | 沿用 YuE2-Studio 已验证的模式,GPU 队列在进程内 |
| 数据库 | SQLite(SQLAlchemy 2.x) | 项目/版本/任务/音乐库索引,单机够用,零运维 |
| 工件存储 | 文件系统 `data/` 目录 + 静态挂载 | 音频/ABC/MIDI/隐变量/PDF 等,按项目-版本落盘 |
| 前端 | Vite + React + TypeScript + **Tailwind CSS v4** + **shadcn/ui** + lucide-react | 按要求用 Tailwind;shadcn 提供成套组件,不手写 UI |
| 波形/乐谱 | wavesurfer.js(移植 YuE2-Studio 的 Waveform)+ **abcjs**(ABC 编辑与五线谱渲染)+ 自绘 SVG 钢琴帘 | abcjs 可解析 ABC 结构直接投影 piano-roll |
| 状态/请求 | TanStack Query + zustand | 任务轮询/SSE、工作区状态 |
| 进度通道 | SSE(`/api/jobs/{id}/events`) | YuE2 pipeline 自带 `on_token / on_progress / cancelled` 回调,天然映射 |
| 部署 | 开发:uvicorn + `npm run dev`(5173 反代 8000);发布:Docker 单镜像或 compose 双容器 | 照搬 YuE2-Studio 的 Dockerfile/compose 改造 |

## 3. 总体架构

```
┌─ web (React + Tailwind + shadcn/ui) ──────────────────────────────┐
│ 创作台 │ 工作区/DAW │ 翻唱流水线 │ 扒谱工具 │ 音乐库 │ 评测 │ 系统  │
└───────────────▲──────────────────────────────────────────────────┘
                │ REST(JSON) + SSE(任务进度) + 静态音频
┌─ FastAPI(单进程,GPU 单卡) ───────────────────────────────────────┐
│ routers: compose / projects / transcribe / library / cover /      │
│          agent / evaluate / jobs / admin(移植)                    │
│ services: JobQueue(移植+扩展优先级双通道)                          │
│           ModelManager(单例懒加载 + 显存预算 + 引用计数)           │
│             ├ YuE2Pipeline(生成/plan/续写/挖补/区域解码)           │
│             ├ SheetSage2(扒谱/节拍/和弦/结构/PDF+钢琴渲染)         │
│             ├ MERT-v2-FullSong / 30s(打标/结构/Embedding)          │
│             ├ HTDemucs-ft(分轨)                                   │
│             ├ Qwen3-ASR-0.6B(歌词转写)                            │
│             └ 编辑 Agent 的 LLM(本地小模型,可 CPU)                │
│ storage: SQLite(jobs/projects/library) + data/ 工件目录            │
└───────────────────────────────────────────────────────────────────┘
```

**任务双通道**:重任务(生成/转录/分轨)串行走 heavy 通道;轻任务(区域试听、嵌入、乐谱渲染)走 interactive 通道,在模型已常驻的前提下与重任务并发(独立 CUDA 流),保证 DAW 里"点哪儿哪儿响"。若实测不稳,退化为单通道 + 高优先级插队。

## 4. 复用清单(从 YuE2-Studio 移植)

| 来源 | 内容 | 去处 |
|---|---|---|
| `services/queue.py` | worker_loop 队列骨架 | 扩展:优先级、双通道、job 持久化到 SQLite |
| `services/inference.py` | 模型加载/生成调用/文件清理 | 改写为 ModelManager + 生成服务 |
| `core/history_db.py`、`core/security.py`、`core/config.py` | 历史/API-Key/Admin Token | 直接移植到新 core |
| `routers/admin.py`、`pages/Admin.tsx` | 队列/磁盘/日志/配置管理页 | 整体移植,补"模型管理"卡片 |
| `web` Waveform 组件、Toast/Modal | 波形与基础 UI | 移入 shadcn 组件体系 |
| Dockerfile / docker-compose / server.sh | 部署 | 改造复用 |
| 本地模型资产 | `~/.cache/huggingface`:YuE2-3B、YuE2-Vae、MERT-v2-30s/FullSong、SheetSage2、HTDemucs-ft、Qwen3-ASR-0.6B | 直接引用;`yue2_infer-0.1.6` wheel 在 YuE2-Studio 目录 |
| model_o_eq 的 round2/3/4 脚本思路 | A/B 对比实验设计 | 评测模块参考 |

## 5. 数据模型(SQLite + 文件系统)

```
Project   一首歌的工作区:id, title, style, lyrics, seed, cot, created_at
Version   项目的一次产物:id, project_id, v, source(generated|imported|punch|merge),
          parent_version, abc, note, config_json, created_at
Job       异步任务:id, type, status(queued|running|done|failed|cancelled),
          progress, params_json, result_json, error, project_id, version_id, 时间戳
LibraryItem 音乐库条目:id, path, title, artist, duration, tags_json(流派/情绪/调性/速度),
          embedding_file, analysis_json(结构分段等), fingerprint
EvalBatch / DuelResult 评测:id, version_ids[], metrics_json, winner, created_at
```

版本工件目录(每次渲染落盘一份,支持任意版本回听/回滚):

```
data/projects/{pid}/versions/{v}/
  song.flac          # 48kHz 立体声成品
  plan.abc           # 乐谱(可编辑的中间产物)
  semantic.bin       # 语义 token(续写/挖补需要)
  latents.safetensors# 隐变量 [帧,64](区域试听/挖补需要)
  stems/*.flac       # 分轨(人声/鼓/贝斯/其他,可选)
  transcription/     # score.abc, *.mid, events.json, *.lab, sheet.pdf(可选)
  edits/             # 该版本的 ABC 编辑草稿
```

## 6. API 设计

完整端点表见 [API.md](API.md)。要点:

- 所有耗时操作返回 `202 {job_id}`,进度走 `GET /api/jobs/{id}/events`(SSE:阶段/百分比/token 速率),支持 `POST /api/jobs/{id}/cancel`(映射 pipeline 的 `cancelled` 回调)。
- 生成三态:`/api/generate`(整曲)、`/api/generate/continue`(从某小节续写)、`/api/generate/punch`(区域挖补);试听走同步快接口 `/api/audition`(隐变量切片解码,<1s)。
- 编辑流:`PUT /api/versions/{id}/abc` 存编辑草稿 → `/api/generate` 带 `abc_draft=true` 重渲染;每次渲染产生新 Version,支持 A/B 对听与回滚。

## 7. 六大功能 → 模型/API/页面映射

| 功能 | 模型链 | 主要 API | 页面 |
|---|---|---|---|
| AI 唱作工作台 | YuE2-3B + Vae | generate / plan / projects / versions | 创作台 + 工作区 |
| 翻唱/风格重制 | HTDemucs → SheetSage2(melody_only) → Qwen3-ASR → YuE2(cot=melody) | cover/prepare(编排任务链)/ lyrics / transcribe | 翻唱流水线(步骤条) |
| Agent 音乐编辑 | YuE2(plan 导出) + 本地 LLM 改谱 | agent/edit(返回 diff,人审后重渲染) | 工作区侧栏"AI 改谱" |
| 自动扒谱 | SheetSage2(+渲染) | transcribe / render | 扒谱工具 |
| 音乐库理解检索 | MERT-FullSong(+SheetSage2 结构) | library/import / analyze / search / playlist | 音乐库 |
| 生成质量评测 | MERT 特征 + Vae 重构 + ASR(PER) | evaluate / duel | 评测(含 A/B 对听) |

## 8. DAW(工作区)可行性要点(已核实推理代码)

- 生成四段全部可拆可缓存:`plan → generate_semantic → synthesize(NAR) → decode(VAE)`,同 seed 同 prefix 确定性复现。
- **局部性实测修正**:prefix(歌词/ABC)对语义生成是全局条件,任何 prefix 改动都会重塑整首演绎;"改动点之前逐比特不变"仅在挖补(直接复用缓存隐变量)时成立。整曲重渲染 = 同内容全新演绎。UI 文案与文档按此修正。
- **区域试听 <1s**:隐变量 25Hz(1 帧 = 1/25s),VAE `decode_tiled` 带 halo,切 [a-16, b+16] 解码后裁剪。
- **续写**:`generate_tokens` 支持自定义 prefix,把已缓存语义 token 拼进 prefix 即可"从第 X 小节重唱"。
- **挖补**:YuE2-Vae 带编码器,可将候选段落编回隐变量域,与原曲做 halo 交叉淡化后整体解码,边界比波形硬拼自然。
- 分轨(HTDemucs)仅用于**显示/独听**,重渲染仍是整曲模型行为。

## 9. 分期路线图(每期验收标准)

**P0 环境与冒烟(先行,半天~1 天)**
- 独立 venv;验证 torch/transformers 版本兼容矩阵(YuE2 官方组合:torch≈2.10 + transformers≈4.57;MERT README:torch 2.6 + transformers 4.53;SheetSage2:torch 2.8)。目标:单环境跑通全部;不行则双 venv + 双推理子进程,由主后端转发。
- 冒烟脚本:YuE2 出 30s 小样;SheetSage2 转 `assets/audio` 示例歌;MERT 提特征;HTDemucs 分轨;ASR 转写;VAE encode→decode 往返。
- ✅ 验收:`smoke/` 全绿,记录实际显存占用表。

**P1 平台骨架 + AI 唱作工作台**
- 新项目骨架(前端 Tailwind v4 + shadcn/ui 就位);移植 queue/security/history/admin;ModelManager 只接 YuE2。
- 页面:创作台(风格/歌词/cot/seed → 生成 → 进度 → 试听/下载)+ 项目与版本列表。
- ✅ 验收:浏览器里从输入到出歌全流程,刷新不丢任务,SSE 进度与取消可用。

**P2 理解工具 + 音乐库**
- SheetSage2 扒谱(含 melody_only、PDF/钢琴渲染)、HTDemucs 分轨、MERT 分析与 Embedding 入库;音乐库页(列表/标签筛选/相似搜索/歌单)。
- ✅ 验收:上传任一 mp3 → 出谱/PDF/分轨/标签;库内相似搜索可用。

**P3 翻唱流水线**
- 编排任务链(分轨→扒谱→ASR 歌词→草稿项目),歌词分节校对 UI,cot=melody 重渲染。
- ✅ 验收:《友谊地久天长》→ 爵士放克版全链路跑通。

**P4 DAW 工作区**
- 时间线(分轨波形 + 小节标尺 + 和弦/歌词轨)、区域选择 → 三策略重渲染(全曲/续写/挖补)、abcjs 联动编辑、版本 A/B。
- ✅ 验收:选中某句 → 试听候选 → 挖补拼回,前文不变,全程无需命令行。

**P5 Agent 编辑 + 评测**
- 本地 LLM 工具化改谱(重和声/移调/发展 Solo,输出 diff 人审);评测模块(MERT 指标 + VAE 重构 + PER)与 duel 对听页。
- ✅ 验收:自然语言指令→谱面 diff→新版本;两个版本可自动出指标并人工对听裁决。

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| 三套模型的 torch/transformers 版本互相打架 | P0 先做兼容矩阵;兜底方案:双 venv + 双推理进程,主后端 HTTP 转发 |
| 显存峰值(生成 + 试听并发) | ModelManager 显存预算 + 引用计数;VAE 解码官方实现自动把 AR 权重挪 CPU;极限时 interactive 通道退化为排队 |
| 转录谱与生成计划谱对齐漂移 | 优先用**生成端缓存的 token↔帧↔秒映射**对齐(生成时天然知道每小节时刻);转录谱只用于导入外部音频 |
| 挖补边界伪影 | 隐变量域 halo 交叉淡化(16 帧 ≈ 0.64s)+ 小节线对齐;实测不达标就退回音频域等功率交叉淡化 |
| 许可证 | 全部权重 CC BY-NC 4.0,**仅限非商用** |
| 缺失资产 | YuE2-Vae-legacy(复现论文基准用)、WildSongBench(评测协议参考)未下载,需要时 `hf download` 补齐 |

## 11. 目录结构(规划)

```
YuE2-Workbench/
├─ backend/
│  ├─ app/
│  │  ├─ main.py            # FastAPI 入口(挂载 routers + 静态)
│  │  ├─ core/              # config / db / security(移植) 
│  │  ├─ models/            # SQLAlchemy 表 + Pydantic schema
│  │  ├─ routers/           # compose, projects, jobs, transcribe, library,
│  │  │                     # cover, agent, evaluate, admin(移植)
│  │  └─ services/
│  │     ├─ queue.py        # 双通道任务队列(移植扩展)
│  │     ├─ models_mgr.py   # ModelManager(懒加载/显存预算/引用计数)
│  │     ├─ yue2_svc.py     # 生成/plan/续写/挖补/区域解码
│  │     ├─ transcribe_svc.py / stems_svc.py / mert_svc.py / asr_svc.py
│  │     └─ agent_svc.py / eval_svc.py
│  └─ tests/
├─ web/                     # Vite + React + TS + Tailwind v4 + shadcn/ui
│  └─ src/{pages,components/{daw,notation,audio},lib,stores}
├─ data/                    # 工件 + SQLite(gitignore)
├─ smoke/                   # P0 冒烟脚本
├─ docs/PLAN.md / API.md
├─ Dockerfile / docker-compose.yml   # 改造自 YuE2-Studio
└─ .env.example
```
