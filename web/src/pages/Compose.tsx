import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Layers, LibraryBig } from 'lucide-react'
import { Loader2, Music4, Sparkles } from 'lucide-react'
import { api, TERMINAL, type Job, type JobEvent } from '@/lib/api'
import { useJobStream } from '@/lib/job'
import { AudioPlayer } from '@/components/AudioPlayer'
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, Page, Progress, Textarea } from '@/components/ui'
import { SelectMenu } from '@/components/SelectMenu'
import { useT } from '@/lib/i18n'

const STAGE_LABEL: Record<string, [string, string]> = {
  load_model: ['加载模型', 'Loading model'],
  plan: ['规划乐谱 (ABC)', 'Planning score (ABC)'],
  semantic: ['生成歌曲 token', 'Generating song tokens'],
  nar: ['合成音频隐变量', 'Synthesizing latents'],
  vae: ['解码音频', 'Decoding audio'],
  done: ['完成', 'Done'],
}

type GenResult = {
  version_id: string
  project_id: string
  v: number
  duration: number
  seed: number
  urls: { audio: string; abc: string }
}

const FORM_KEY = 'wb_compose'
const DEFAULT_PRESETS = [
  { label: ['流行抒情', 'Pop ballad'], style: 'Mandopop ballad, emotional female vocal, piano, strings, gentle drums' },
  { label: ['爵士放克', 'Jazz-funk'], style: 'Jazz-funk, warm lead vocal, Rhodes piano, electric bass, tight drums' },
  { label: ['城市 R&B', 'Urban R&B'], style: 'Urban R&B, smooth vocal, electric piano, sub bass, laid-back groove' },
  { label: ['民谣', 'Folk'], style: 'Chinese folk, acoustic guitar, soft male vocal, warm and intimate' },
  { label: ['电子舞曲', 'EDM'], style: 'EDM, powerful female vocal, synth leads, four-on-the-floor kick, bright plucks' },
  { label: ['摇滚', 'Rock'], style: 'Alternative rock, gritty male vocal, distorted guitars, live drums, energetic' },
]

function loadForm(): Partial<{ title: string; style: string; lyrics: string; cot: string; seedText: string; cfgText: string }> {
  try {
    return JSON.parse(localStorage.getItem(FORM_KEY) ?? 'null') ?? {}
  } catch {
    return {}
  }
}

export function ComposePage() {
  const t = useT()
  const saved = useMemo(loadForm, [])
  const [title, setTitle] = useState(saved.title ?? '')
  const [style, setStyle] = useState(
    saved.style ?? 'Jazz-funk, warm lead vocal, Rhodes piano, electric bass, tight drums',
  )
  const [lyrics, setLyrics] = useState(
    saved.lyrics ??
      '[Verse]\n夜色漫过窗台 思绪不肯睡去\n霓虹在街角练习一支舞\n\n[Chorus]\n今晚不眠 让节拍带路\n心跳和贝斯一起失守',
  )
  const [cot, setCot] = useState<'full' | 'melody' | 'off'>((saved.cot as 'full' | 'melody' | 'off') ?? 'full')
  const [seedText, setSeedText] = useState(saved.seedText ?? '')
  // keep the raw text so intermediate states like "1." survive typing
  const [cfgText, setCfgText] = useState(saved.cfgText ?? '1.0')
  const cfg = Math.min(2, Math.max(1, Number(cfgText) || 1))
  const [presets, setPresets] = useState<{ label: string; style: string }[]>(() => {
    try {
      const user = JSON.parse(localStorage.getItem('wb_style_presets') ?? 'null')
      return [...DEFAULT_PRESETS, ...(Array.isArray(user) ? user : [])]
    } catch {
      return DEFAULT_PRESETS
    }
  })
  const [refInfo, setRefInfo] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // seed sweep: same form, N variants with different seeds; job ids survive a refresh
  const [sweepMode, setSweepMode] = useState(false)
  const [sweepCount, setSweepCount] = useState(3)
  const [sweepJobIds, setSweepJobIds] = useState<string[] | null>(() => {
    try {
      const raw = localStorage.getItem('wb_sweep')
      const parsed = raw ? (JSON.parse(raw) as string[]) : null
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
    } catch {
      return null
    }
  })
  const [sweepSettled, setSweepSettled] = useState(false)
  const { events, done, job, result } = useJobStream(jobId)

  const latest = useMemo(() => lastStageEvent(events), [events])
  const elapsed = useElapsed(jobId, done)

  // persist the form so a refresh never loses work in progress
  useEffect(() => {
    localStorage.setItem(FORM_KEY, JSON.stringify({ title, style, lyrics, cot, seedText, cfgText }))
  }, [title, style, lyrics, cot, seedText, cfgText])

  // reference-track style prefill (from Library "以此曲风格创作")
  const location = useLocation()
  useEffect(() => {
    const refItemId = (location.state as { refItemId?: string } | null)?.refItemId
    if (!refItemId) return
    api<{ title: string; tags: string[]; key?: string | null; tempo?: number | null }>(`/library/${refItemId}`)
      .then((it) => {
        const parts = [...(it.tags ?? [])]
        if (it.key) parts.push(it.key)
        if (it.tempo) parts.push(`${Math.round(it.tempo)} BPM`)
        if (parts.length) setStyle(parts.join(', '))
        setRefInfo(t(`已从「${it.title}」导入风格标签,可再手改`, `Style tags imported from “${it.title}” — edit freely`))
      })
      .catch(() => {})
    window.history.replaceState({}, '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // lyrics doctor: cheap structural hints before burning GPU time
  const lyricDiag = useMemo(() => {
    const lines = lyrics.split('\n').map((s) => s.trim())
    const sections = lines.filter((l) => /^\[[^\]]+\]$/.test(l)).length
    const body = lines.filter((l) => l && !l.startsWith('['))
    const long = body.filter((l) => [...l].length > 18).length
    const issues: string[] = []
    if (body.length === 0) issues.push(t('还没有歌词内容', 'No lyrics yet'))
    else if (sections === 0) issues.push(t('没有 [Verse]/[Chorus] 等段落标记', 'No [Verse]/[Chorus] section markers'))
    if (long > 0) issues.push(t(`${long} 行超过 18 字,演唱可能被截断`, `${long} lines exceed 18 chars — singing may be cut off`))
    return { sections, body: body.length, long, issues }
  }, [lyrics])

  async function submit() {
    setError(null)
    if (!title.trim()) {
      setError(t('请先给作品起个歌名', 'Give the song a title first'))
      return
    }
    setSubmitting(true)
    try {
      if (sweepMode) {
        const res = await api<{ job_ids: string[]; seeds: number[]; project_id: string }>('/generate/sweep', {
          method: 'POST',
          body: JSON.stringify({ title: title.trim(), style, lyrics, cot, n: sweepCount, cfg_scale: cfg }),
        })
        localStorage.setItem('wb_sweep', JSON.stringify(res.job_ids))
        setSweepJobIds(res.job_ids)
        setSweepSettled(false)
      } else {
        const seed = seedText.trim() === '' ? null : Number(seedText)
        const res = await api<{ job_id: string; project_id: string }>('/generate', {
          method: 'POST',
          body: JSON.stringify({ title: title.trim(), style, lyrics, cot, seed, cfg_scale: cfg }),
        })
        setJobId(res.job_id)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Page className="lg:flex lg:h-full lg:min-h-0 lg:flex-col">
      <div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[400px_1fr]">
      <Card className="lg:flex lg:min-h-0 lg:flex-col">
        <CardHeader title={<span className="flex items-center gap-2"><Music4 size={15} /> {t('新建作品', 'New song')}</span>} desc={t('歌词 + 风格 → 完整歌曲(人声 + 伴奏)', 'Lyrics + style → a full song (vocals + backing)')} />
        <CardBody className="space-y-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto">
          <div>
            <Label hint={t('必填,可以重名', 'Required, duplicates OK')}>{t('歌名', 'Title')}</Label>
            <Input
              value={title}
              placeholder={t('给这首作品起个名字', 'Name this song')}
              maxLength={60}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="shrink-0">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-xs font-medium text-zinc-300">{t('风格', 'Style')}</span>
              <span className="flex-1" />
              <SelectMenu
                className="w-36 shrink-0"
                value=""
                onChange={(v) => {
                  const p = presets.find((x) => x.label === v)
                  if (p) setStyle(p.style)
                }}
                options={[{ value: '', label: t('风格预设…', 'Style presets…') }, ...presets.map((p) => ({ value: t(p.label[0], p.label[1]), label: t(p.label[0], p.label[1]) }))]}
              />
              <button
                className="text-[11px] text-zinc-500 hover:text-emerald-400"
                onClick={() => {
                  const label = window.prompt(t('预设名称(将当前风格保存为预设)', 'Preset name (save the current style as a preset)'))
                  if (!label || !style.trim()) return
                  const next = [...presets, { label: label.trim(), style }]
                  setPresets(next)
                  localStorage.setItem('wb_style_presets', JSON.stringify(next.slice(DEFAULT_PRESETS.length)))
                }}
              >
                {t('存为预设', 'Save preset')}
              </button>
            </div>
            <Textarea rows={3} value={style} onChange={(e) => setStyle(e.target.value)} />
            {refInfo && <div className="mt-1 text-[11px] text-emerald-400/80">{refInfo}</div>}
          </div>
          <div className="flex min-h-40 flex-1 flex-col">
            <div className="mb-1.5 flex shrink-0 items-baseline justify-between">
              <span className="text-xs font-medium text-zinc-300">{t('歌词', 'Lyrics')}</span>
              <span className="text-[11px] text-zinc-500">{t('[Verse] [Chorus] 等段落标记', '[Verse] [Chorus] section markers')}</span>
            </div>
            <Textarea rows={4} value={lyrics} onChange={(e) => setLyrics(e.target.value)} className="min-h-0 flex-1 resize-none font-mono text-[13px]" />
            <div className="mt-1.5 flex shrink-0 flex-wrap items-center gap-1.5 text-[11px]">
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">{t('段落', 'Sections')} {lyricDiag.sections}</span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">{t('歌词行', 'Lines')} {lyricDiag.body}</span>
              {lyricDiag.issues.map((msg) => (
                <span key={msg} className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-400">
                  {msg}
                </span>
              ))}
              {!lyricDiag.issues.length && lyricDiag.body > 0 && (
                <span className="text-emerald-400/80">{t('结构看起来不错', 'Structure looks good')}</span>
              )}
            </div>
          </div>
          <div className="shrink-0">
            <Label hint={t('规划得越细,出歌越慢', 'Finer planning, slower generation')}>{t('规划模式', 'Planning mode')}</Label>
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-zinc-700 bg-zinc-950/60 p-1">
              {([
                { value: 'full', label: t('完整规划', 'Full plan'), sub: t('旋律 + 和弦', 'melody + chords') },
                { value: 'melody', label: t('仅旋律谱', 'Melody only'), sub: t('跳过和弦', 'skip chords') },
                { value: 'off', label: t('直接生成', 'Direct'), sub: t('最快出歌', 'fastest') },
              ] as const).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setCot(o.value as typeof cot)}
                  className={`rounded-md px-1 py-1.5 text-center transition-colors ${cot === o.value ? 'bg-emerald-500/15 text-emerald-300' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  <span className="block text-[13px] font-medium">{o.label}</span>
                  <span className="block text-[11px] text-current opacity-70">{o.sub}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-3">
            <div>
              <Label>Seed</Label>
              <Input value={seedText} placeholder={t('随机', 'Random')} onChange={(e) => setSeedText(e.target.value.replace(/[^0-9]/g, ''))} />
            </div>
            <div>
              <Label hint={cfg.toFixed(2)}>CFG</Label>
              <Input
                type="number"
                step="0.05"
                min="1"
                max="2"
                value={cfgText}
                onChange={(e) => setCfgText(e.target.value)}
                onBlur={() => setCfgText(cfg.toFixed(2))}
              />
            </div>
          </div>
          {sweepMode && (
            <div className="shrink-0">
              <Label hint={t('同表单跑 N 个随机 seed,串行生成', 'Run N random seeds of this form, serially')}>{t('变体数量', 'Variants')}</Label>
              <SelectMenu
                value={String(sweepCount)}
                onChange={(v) => setSweepCount(Number(v))}
                options={[2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} ${t('个变体', 'variants')}` }))}
              />
            </div>
          )}
          {error && <div className="shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
        </CardBody>
        <div className="shrink-0 space-y-3 border-t border-zinc-800 p-4">
          <Button className="w-full" onClick={submit} disabled={submitting || !!jobId && !done || !!sweepJobIds && !sweepSettled || !title.trim()}>
            {jobId && !done || !!sweepJobIds && !sweepSettled ? <Loader2 className="animate-spin" size={15} /> : sweepMode ? <Layers size={15} /> : <Sparkles size={15} />}
            {jobId && !done ? t('生成中…', 'Generating…') : sweepMode ? `${t('批量生成', 'Batch-generate')} ${sweepCount} ${t('个变体', 'variants')}` : t('生成歌曲', 'Generate song')}
          </Button>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={sweepMode}
              onChange={(e) => setSweepMode(e.target.checked)}
              className="accent-emerald-500"
              disabled={!!sweepJobIds && !sweepSettled}
            />
            {t('种子扫描模式(同词同曲风,多个 seed 出变体,跑完可自动评测对比)', 'Seed-sweep mode: same lyrics & style, multiple seeds, auto-evaluated at the end')}
          </label>
        </div>
      </Card>

      <div className="space-y-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
        {sweepJobIds && (
          <SweepPanel
            jobIds={sweepJobIds}
            onSettled={() => setSweepSettled(true)}
            onClear={() => {
              localStorage.removeItem('wb_sweep')
              setSweepJobIds(null)
              setSweepSettled(false)
            }}
          />
        )}
        {!sweepJobIds && !jobId && <EmptyState />}
        {jobId && <JobPanel jobId={jobId} latest={latest} events={events} elapsed={elapsed} done={done} />}
        {done && result && <ResultCard result={result as GenResult} job={job} />}
      </div>
    </div>
    </Page>
  )
}

function useElapsed(jobId: string | null, done: boolean) {
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!jobId || done) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [jobId, done])
  return now
}

function lastStageEvent(events: JobEvent[]): JobEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].stage) return events[i]
  }
  return undefined
}

function EmptyState() {
  const t = useT()
  return (
    <Card className="flex h-full min-h-[420px] items-center justify-center">
      <div className="text-center text-sm text-zinc-500">
        <Music4 size={40} className="mx-auto mb-3 text-zinc-700" />
        {t('填好风格和歌词,点"生成歌曲"', 'Set style and lyrics, then hit “Generate song”')}
        <div className="mt-1 text-xs text-zinc-600">{t('整曲生成约 1~2 分钟,进度实时显示在右侧', 'A full song takes ~1–2 min; progress shows on the right')}</div>
      </div>
    </Card>
  )
}

function JobPanel({
  jobId,
  latest,
  events,
  elapsed,
  done,
}: {
  jobId: string
  latest?: JobEvent
  events: JobEvent[]
  elapsed: number
  done: boolean
}) {
  const t = useT()
  const stagePair = latest ? STAGE_LABEL[latest.stage ?? ''] : undefined
  const start = events[0]?.t ?? Date.now() / 1000
  const secs = Math.max(0, Math.round(elapsed / 1000 - start))
  return (
    <Card>
      <CardHeader
        title={t('生成进度', 'Generation progress')}
        desc={`job ${jobId}`}
        right={<Badge status={done ? latest?.status ?? 'done' : 'running'} />}
      />
      <CardBody className="space-y-3">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium text-zinc-200">
            {latest ? (stagePair ? t(stagePair[0], stagePair[1]) : latest.stage) : t('排队中…', 'Queued…')}
          </span>
          <span className="text-xs text-zinc-500">{done ? t('完成', 'Done') : `${secs}s`}</span>
        </div>
        <Progress value={done ? 100 : null} />
        <div className="grid grid-cols-3 gap-2 text-xs text-zinc-400">
          <div>tokens: <span className="text-zinc-200">{latest?.tokens ?? '—'}</span></div>
          <div>tok/s: <span className="text-zinc-200">{latest?.tps ?? '—'}</span></div>
          <div className="truncate" title={latest?.detail}>{latest?.detail ?? ''}</div>
        </div>
        {latest?.status === 'failed' && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{latest.error}</div>
        )}
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer select-none">{t('事件流', 'Events')} ({events.length})</summary>
          <div className="mt-2 max-h-40 space-y-0.5 overflow-auto rounded-lg bg-zinc-950 p-2 font-mono text-[11px]">
            {events.map((e, i) => (
              <div key={i}>{JSON.stringify(e)}</div>
            ))}
          </div>
        </details>
      </CardBody>
    </Card>
  )
}

function ResultCard({ result, job }: { result: GenResult; job: ReturnType<typeof useJobStream>['job'] }) {
  const t = useT()
  const [libJob, setLibJob] = useState<string | null>(null)
  const libStream = useJobStream(libJob)
  return (
    <Card>
      <CardHeader
        title={t('生成完成', 'Generation complete')}
        desc={`${result.duration}s · seed ${result.seed} · v${result.v}`}
        right={
          <Link to={`/projects/${result.project_id}`} className="text-xs text-emerald-400 hover:underline">
            {t('打开项目 →', 'Open project →')}
          </Link>
        }
      />
      <CardBody className="space-y-3">
        <AudioPlayer url={result.urls.audio} />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <a className="text-zinc-400 hover:text-emerald-400" href={result.urls.audio} download>{t('下载 FLAC', 'Download FLAC')}</a>
          <a className="text-zinc-400 hover:text-emerald-400" href={result.urls.abc} target="_blank" rel="noreferrer">{t('查看 ABC 乐谱', 'View ABC score')}</a>
          {job?.error && <span className="text-red-400">{job.error}</span>}
          <span className="flex-1" />
          <Button size="sm" variant="outline" disabled={!!libJob && !libStream.done}
            onClick={() => api<{ job_id: string }>('/library/import-version', {
              method: 'POST',
              body: JSON.stringify({ version_id: result.version_id }),
            }).then((r) => setLibJob(r.job_id)).catch((e) => alert(String(e)))}
            title={t('加入音乐库(自动分析打标)', 'Add to library (auto-tagged)')}>
            {libJob && !libStream.done ? <Loader2 className="animate-spin" size={13} /> : <LibraryBig size={13} />} {t('加入音乐库', 'Add to library')}
          </Button>
        </div>
        {libJob && !libStream.done && <div className="text-xs text-zinc-500">{t('正在分析入库…(MERT 特征 + 标签)', 'Analyzing for library… (MERT features + tags)')}</div>}
        {libStream.done && libStream.job?.result && (
          <div className="text-xs text-emerald-400">{t('已加入音乐库,', 'Added to library,')}<Link to="/library" className="hover:underline">{t('去查看 →', 'view →')}</Link></div>
        )}
      </CardBody>
    </Card>
  )
}

type SweepResult = GenResult & { project_id: string }

function SweepPanel({
  jobIds,
  onSettled,
  onClear,
}: {
  jobIds: string[]
  onSettled: () => void
  onClear: () => void
}) {
  const t = useT()
  const [jobs, setJobs] = useState<Record<string, Job>>({})
  const [duelJobId, setDuelJobId] = useState<string | null>(null)
  const duelStream = useJobStream(duelJobId)
  const settledRef = useRef(false)

  const active = jobIds.filter((id) => jobs[id] && !TERMINAL.has(jobs[id].status)).length
  const doneRows = jobIds
    .map((id) => jobs[id])
    .filter((j) => j?.status === 'done' && j.result)
  const allDone = jobIds.length > 0 && active === 0

  useEffect(() => {
    let alive = true
    const poll = () => {
      Promise.all(
        jobIds.map((id) => api<Job>(`/jobs/${id}`).then((j) => [id, j] as const).catch(() => null)),
      ).then((pairs) => {
        if (!alive) return
        const next: Record<string, Job> = {}
        for (const p of pairs) if (p) next[p[0]] = p[1]
        setJobs(next)
      })
    }
    poll()
    const t = setInterval(poll, 2500)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [jobIds])

  useEffect(() => {
    if (allDone && !settledRef.current) {
      settledRef.current = true
      onSettled()
    }
  }, [allDone, onSettled])

  function runDuel() {
    const ids = doneRows.slice(0, 2).map((j) => (j.result as SweepResult).version_id)
    api<{ job_id: string }>('/evaluate', {
      method: 'POST',
      body: JSON.stringify({ version_ids: ids, labels: ['A', 'B'] }),
    })
      .then((r) => setDuelJobId(r.job_id))
      .catch((e) => alert(String(e)))
  }

  const duel = duelStream.result as
    | { evals: Record<string, unknown>; duel: { rows: { metric: string; a: unknown; b: unknown; winner: string | null }[]; auto_suggestion: string } | null }
    | undefined

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Layers size={15} /> {t('种子扫描', 'Seed sweep')}({doneRows.length}/{jobIds.length} {t('完成', 'done')})</span>}
        desc={t('同词同曲风不同 seed,串行生成;挑最好的进项目继续加工', 'Same lyrics & style, different seeds, generated serially — keep the best and keep working')}
        right={
          <button className="text-xs text-zinc-400 hover:text-zinc-200" onClick={onClear}>
            {allDone ? t('收起', 'Collapse') : t('后台运行(任务中心可见)', 'Running in background (see task center)')}
          </button>
        }
      />
      <CardBody className="space-y-3">
        {jobIds.map((id, i) => {
          const j = jobs[id]
          const res = j?.result as SweepResult | undefined
          return (
            <div key={id} className="rounded-lg border border-zinc-800 p-2.5">
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 font-mono text-xs text-zinc-400">#{i + 1}</span>
                {j ? <Badge status={j.status} /> : <Badge status="queued" />}
                <span className="text-xs text-zinc-500">
                  {j?.params && (j.params as Record<string, unknown>).seed != null
                    ? `seed ${String((j.params as Record<string, unknown>).seed)}`
                    : t('排队中…', 'Queued…')}
                </span>
                <span className="flex-1" />
                {j?.status === 'failed' && <span className="min-w-0 truncate text-[11px] text-red-400">{j.error}</span>}
                {res && <span className="text-[11px] text-zinc-500">{res.duration}s</span>}
              </div>
              {res && (
                <div className="mt-2 flex items-center gap-3">
                  <div className="min-w-0 flex-1"><AudioPlayer url={res.urls.audio} height={40} /></div>
                  <Link to={`/projects/${res.project_id}`} className="shrink-0 text-xs text-emerald-400 hover:underline">
                    {t('打开项目 →', 'Open project →')}
                  </Link>
                </div>
              )}
            </div>
          )
        })}

        {allDone && doneRows.length >= 2 && !duelJobId && (
          <Button size="sm" variant="outline" onClick={runDuel}>
            {t('自动评测对比(前两个变体)', 'Auto-evaluate & compare (first two)')}
          </Button>
        )}
        {duelJobId && !duelStream.done && (
          <div className="text-xs text-zinc-500">
            {t('评测中…', 'Evaluating…')}{duelStream.events.length > 0 && ` · ${duelStream.events[duelStream.events.length - 1].detail ?? ''}`}
          </div>
        )}
        {duelStream.done && duel?.duel && (
          <div className="overflow-hidden rounded-lg border border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900 text-zinc-400">
                <tr><th className="px-2 py-1.5 text-left">{t('指标', 'Metric')}</th><th className="px-2 py-1.5">A</th><th className="px-2 py-1.5">B</th><th className="px-2 py-1.5">{t('占优', 'Favors')}</th></tr>
              </thead>
              <tbody>
                {duel.duel.rows.map((r, i) => (
                  <tr key={i} className="border-t border-zinc-800">
                    <td className="px-2 py-1.5 text-zinc-300">{r.metric}</td>
                    <td className="px-2 py-1.5 text-center font-mono text-zinc-400">{String(r.a ?? '—')}</td>
                    <td className="px-2 py-1.5 text-center font-mono text-zinc-400">{String(r.b ?? '—')}</td>
                    <td className={`px-2 py-1.5 text-center ${r.winner === 'tie' ? 'text-zinc-500' : 'text-emerald-400'}`}>{r.winner ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-[11px] text-zinc-400">
              {t('自动倾向:', 'Auto leans toward:')}<span className="text-emerald-400">{duel.duel.auto_suggestion}</span>({t('最终以人耳对听为准,进项目用 A/B 对比', 'ears have the final say — compare A/B in the project')})
            </div>
          </div>
        )}
        {duelStream.done && duel && !duel.duel && (
          <div className="text-xs text-zinc-500">{t('评测完成,但变体不足两个有效结果,无法对比。', 'Evaluation finished, but fewer than two valid variants — cannot compare.')}</div>
        )}
      </CardBody>
    </Card>
  )
}
