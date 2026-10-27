# 标签探针:原理与自行训练

音乐库的流派/乐器标签由预训练探针生成:`backend/app/services/tag_probes.joblib`
(62K,随仓库分发,开箱即用)。原理:冻结 MERT 歌曲向量,在每个标签上训练一个
逻辑回归头;训练数据是 MagnaTagATune(25,860 条 30s 片段、社区标注)。

已上线的 14 个探针在验证集上的表现(平均精度 AP):

| 类别 | 标签(中文) | AP |
|---|---|---|
| 流派 | 摇滚 0.79 · 古典 0.65 · 嘻哈 0.63 · 金属 0.60 · 氛围 0.60 · 爵士 0.55 · 蓝调 0.48 · 流行 0.47 · 电子 0.44 | |
| 乐器 | 吉他 0.75 · 钢琴 0.74 · 小提琴 0.70 · 鼓 0.47 · 弦乐 0.43 | |

主观情绪标签(忧郁/平静/欢快等)在 MTT 标注里噪声太大(AP < 0.14),
**有意未上线**——它们仍由启发式规则(响度/亮度/调性)兜底,可在库里人工纠正。

## 不满意?自己训练

前提:`install.sh` 装好的环境(需 sklearn)、约 6GB 磁盘、一块 GPU。

```bash
# 1. 下载数据集(约 3GB,hfd.sh 直连镜像,不走代理)
env -u http_proxy -u https_proxy HF_ENDPOINT=https://hf-mirror.com \
  bash /path/to/hfd.sh confit/magnatagatune --dataset \
  --local-dir /home/you/models/magnatagatune -x 8

# 2. 提特征(全量约 20 分钟,断点可续)
.venv/bin/python backend/scripts/extract_mtt_embeddings.py \
  --dataset /home/you/models/magnatagatune

# 3. 训练(约 2 分钟;AP<0.4 的标签自动淘汰)
.venv/bin/python backend/scripts/train_tag_probes.py \
  --dataset /home/you/models/magnatagatune
```

产物 `data/mtt_probes/probes.joblib` **优先于打包版**生效:重启后端,或直接在
音乐库点条目上的"重打标"按钮 ↻。

想换标签集?编辑 `backend/scripts/train_tag_probes.py` 里的 `TAGS` 映射
(键必须是 MTT 标注表里存在的英文标签),重跑第 3 步即可。
