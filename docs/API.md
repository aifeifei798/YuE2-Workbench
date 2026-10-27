# YuE2-Workbench API 设计(v1)

约定:
- 前缀 `/api`;除标注"同步"外,耗时操作一律 `202 {"job_id": "..."}`,结果查询走任务接口。
- 静态音频走 `/audio/...`(映射 `data/`),前端直接 `<audio src>`/wavesurfer 加载。
- SSE:`GET /api/jobs/{id}/events` 推送 `{stage, progress, total, detail, tokens_per_sec}`;阶段示例:`planning(ABC 采样) → semantic(语义 AR) → nar(流匹配 steps) → vae(分块解码)`。
- 鉴权:沿用 YuE2-Studio 模式——本地默认免鉴权,公网部署开启 API-Key / Admin Token。

## 1. 任务系统

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/jobs?limit=` | 任务列表(默认 50 条,暂无 status/type/project_id 过滤) |
| GET | `/api/jobs/{id}` | 任务详情(含 result) |
| GET | `/api/jobs/{id}/events` | SSE 进度流 |
| POST | `/api/jobs/{id}/cancel` | 取消(映射 pipeline `cancelled`) |
| DELETE | `/api/jobs/{id}` | 清理失败/完成任务记录 |

## 2. 项目与版本

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/projects` | 列表 / 创建(style, lyrics, seed, cot) |
| GET/PATCH/DELETE | `/api/projects/{id}` | 详情(含版本树)/ 更新 / 删除 |
| GET | `/api/projects/{id}/versions` | 版本树(source/parent/note) |
| GET | `/api/versions/{id}` | 版本清单(abc、config、时长、工件路径、timing) |
| GET | `/api/versions/{id}/audio?start=&end=` | 音频区间(秒)流式返回——快速试听 |
| PUT | `/api/versions/{id}/abc` | 保存 ABC 编辑草稿(body: `{abc, note}`) |
| POST | `/api/versions/{id}/fork` | 复制为新草稿分支 |
| DELETE | `/api/versions/{id}` | 删除版本(级联工件,回收磁盘) |

## 3. 生成(YuE2)

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/generate` | 整曲生成。`{project_id, style, lyrics, seed?, cot: full\|melody\|off, cfg_scale?, abc?: "draft"\|"<abc文本>", best_of?}` → 新 Version |
| POST | `/api/plan` | 只出 ABC 计划谱,不渲染音频(快速预览)。`{style, lyrics, seed, cot}` → `{abc, timing}` |
| POST | `/api/generate/continue` | 续写:从某版本第 N 小节起新演绎。`{version_id, from_bar, style?, edited_abc?}` |
| POST | `/api/generate/punch` | 区域挖补:`{version_id, region:[t0,t1], candidates: 3~8, seeds?, edited_abc?}` → 生成候选段,人选后拼回 |
| POST | `/api/punch/apply` | `{version_id, punch_id, idx, note?}` → 新 Version(punch_id 来自挖补任务 result) |
| POST | `/api/audition` | **同步**,区域试听:`{version_id, region:[t0,t1], seed?}` → `{audio_url}`(<1s,隐变量切片解码;seed 给定时返回该 seed 的候选段试听) |
| GET | `/api/versions/{id}/candidates` | 挖补候选列表(试听/采用) |

## 4. 扒谱与渲染(SheetSage2)

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/transcribe` | `{file?|version_id?, melody_only?, render_audio?, render_score?: "pdf,svg,png"}` → `{abc, midi_urls, events, sheet_urls, piano_urls}` |
| POST | `/api/score/render` | 已有 ABC/MIDI 重渲染,不加载模型:`{abc?|midi_url?, parts?, formats?}` |
| GET | `/api/versions/{id}/transcription` | 该版本的转录结果缓存 |

## 5. 分轨(HTDemucs)

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/stems` | `{file?|version_id?}` → `{stems: {vocals,drums,bass,other}: url}` |
| GET | `/api/versions/{id}/stems` | 已有分轨 |

## 6. 歌词(ASR)与翻唱流水线

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/lyrics` | `{file?|stem_url?}` → `{text, segments:[{t0,t1,text}]}`(人工校对前的原始稿) |
| POST | `/api/cover/prepare` | **编排任务链**:上传老歌 → 分轨 → melody_only 扒谱 → ASR 歌词 → 生成草稿项目 `{project_id, abc, lyrics_raw, suggestions}` |
| POST | `/api/cover/finalize` | 校对完成后以 `cot="melody"` + 目标风格出歌(等价 `/api/generate` 语法糖) |

## 7. 音乐库(MERT)

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/library/import` | `{file, title?, artist?}` → 导入 + 自动分析(打标+Embedding+结构) |
| POST | `/api/analyze` | 对版本/文件单独分析:`{file?|version_id?}` → `{tags:{genre,mood,key,tempo,energy}, segments, embedding_url}` |
| GET | `/api/library?tag=&q=&sort=` | 库列表/筛选 |
| GET | `/api/library/{id}/similar?k=` | 相似曲(MERT 向量余弦) |
| POST | `/api/library/playlist` | `{item_id, n, diversity?}` → 歌单 |
| POST | `/api/library/dedup` | 翻唱/重复检测(成对相似度报告) |

## 8. Agent 编辑

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/agent/edit` | `{version_id, instruction}`(如"副歌改成 Jazz 和声,发展一段萨克斯 Solo")→ `{diff, proposed_abc, proposed_style?, explanation}`(不直接渲染) |
| POST | `/api/agent/apply` | 采纳 diff → 存草稿/触发重渲染(走 `/api/generate`) |
| GET | `/api/agent/history?project_id=` | 该项目的多轮编辑记录(对应官方 14 版迭代式工作流) |

## 9. 评测

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/evaluate` | `{version_ids[]}` → 每版指标:`{musicality_proxy(MERT), vae_recon_error, per(ASR 音素错误率), loudness, duration}` |
| POST | `/api/duel` | `{a: version_id, b: version_id}` → 指标对比 + 建议胜者 + `/duel/{id}` 对听页数据 |

## 10. 系统与管理(移植自 YuE2-Studio Admin)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/healthz` | `{status, models:{name:{loaded,vram_mb}}, gpu}` |
| GET/POST | `/api/models`, `/api/models/{name}/load`, `/api/models/{name}/unload` | 模型清单与手动装卸 |
| GET/POST | `/api/auth/*`、`/api/admin/*` | 登录、队列/磁盘/日志/配置(照搬) |

## 关键对象示例

`POST /api/generate` 请求:
```json
{
  "project_id": "p_01H...",
  "style": "Jazz-funk, warm lead vocal, Rhodes piano, electric bass, tight drums",
  "lyrics": "[Verse]\n...\n[Chorus]\n...",
  "seed": 831001,
  "cot": "full",
  "cfg_scale": 1.2
}
```

`GET /api/versions/{id}` 响应(节选):
```json
{
  "id": "v_03", "project_id": "p_01H...", "v": 3, "source": "generated",
  "parent_version": "v_02", "note": "副歌改爵士和声",
  "abc_url": "/audio/projects/p_01H/versions/v_03/plan.abc",
  "audio_url": "/audio/projects/p_01H/versions/v_03/song.flac",
  "latents_url": "/audio/projects/p_01H/versions/v_03/latents.safetensors",
  "duration": 214.8, "config": {"cot": "full", "cfg_scale": 1.0, "seed": 831001},
  "timing": {"e2e_seconds": 71.0}
}
```


---

## 已实现对账(2026-10-27 清账)

以下端点已在清账轮补齐,与上文设计一致或为等价实现:

- `POST /api/upload`(multipart 上传音频,返回 `path`/`url`,供 lyrics/analyze/transcribe 等使用)
- `GET /api/versions/{id}`(含 abc_draft、has_transcription/stems/beats/analysis 标志)
- `DELETE /api/versions/{id}`、`POST /api/versions/{id}/fork`
- `PUT /api/versions/{id}/abc`(草稿落盘到版本目录 edits/draft.json)
- `GET /api/versions/{id}/transcription`(abc+文件+摘要+节拍数)
- `GET /api/versions/{id}/stems`、`POST /api/stems {version_id}` 已支持
- `POST /api/lyrics {path|version_id, language?}`(独立歌词转写任务,`202 {job_id}`)
- `POST /api/analyze {version_id|path}`(MERT 特征+结构+标签,版本落 analysis.json,`202 {job_id}`)
- `POST /api/library/dedup?threshold=0.85`(成对相似报告)
- `GET /api/agent/history?version_id=`、`POST /api/agent/apply`(采纳为草稿;编辑历史落盘 agent_history.json)
- `POST /api/duel {a,b}`(同步,要求两版均已评测)
- `GET /api/models`、`POST /api/models/{name}/load`(任务)/`unload`(同步);前端新增"系统"页
- `DELETE /api/jobs/{id}`(仅限终态任务)
- `GET /api/versions/{id}/export/score.pdf?src=plan|transcription`(服务端 verovio+cairosvg 渲染乐谱 PDF,多页自动合并)
- `GET /api/versions/{id}/export/instrumental`(分轨混音去人声伴奏)、`POST /api/versions/{id}/cover`(程序化封面)、`GET /api/versions/{id}/export/release`(发布包:flac+mp3+封面+乐谱PDF+歌词/LRC+ABC)
- `GET /api/blind/pair`、`POST /api/blind/vote`、`GET /api/blind/stats`(盲测投票 + ELO)
- `POST /api/generate/sweep`(种子扫描批量变体)、`POST /api/jobs/{id}/retry`(失败任务重试)
- `GET /api/lyrics {version_id}`(带时间戳歌词对齐,参考歌词模糊对齐,落盘 lyrics.lrc)

## 变体实现(设计等价,非缺口)

- `POST /api/generate/continue` → 由 `/api/generate/punch` 覆盖尾段 + apply 承担("尾段重唱")
- `POST /api/cover/finalize` → 前端直接以 `cot="melody"` + abc 调 `/api/generate`
- `GET /api/versions/{id}/candidates` → 挖补任务 result 内返回候选

## 明确挂账

- Admin/鉴权体系(ADMIN_TOKEN、队列管理页、限流):单机自用暂缺,公网部署前必须补,连同 Docker 一起排期。
- MERT 流派/情绪探针打标:现为启发式规则;真探针需下载 MagnaTagATune/EmoMusic 训练,单独排期。
