import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LibraryBig } from 'lucide-react'
import { Loader2, Music4, Sparkles } from 'lucide-react'
import { api, type JobEvent } from '@/lib/api'
import { useJobStream } from '@/lib/job'
import { AudioPlayer } from '@/components/AudioPlayer'
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, Progress, Textarea } from '@/components/ui'
import { SelectMenu } from '@/components/SelectMenu'

const STAGE_LABEL: Record<string, string> = {
  load_model: '加载模型',
  plan: '规划乐谱 (ABC)',
  semantic: '生成歌曲 token',
  nar: '合成音频隐变量',
  vae: '解码音频',
  done: '完成',
}

type GenResult = {
  version_id: string
  project_id: string
  v: number
  duration: number
  seed: number
  urls: { audio: string; abc: string }
}

export function ComposePage() {
  const [title, setTitle] = useState('')
  const [style, setStyle] = useState(
    'Jazz-funk, warm lead vocal, Rhodes piano, electric bass, tight drums',
  )
  const [lyrics, setLyrics] = useState(
    '[Verse]\n夜色漫过窗台 思绪不肯睡去\n霓虹在街角练习一支舞\n\n[Chorus]\n今晚不眠 让节拍带路\n心跳和贝斯一起失守',
  )
  const [cot, setCot] = useState<'full' | 'melody' | 'off'>('full')
  const [seedText, setSeedText] = useState('')
  // keep the raw text so intermediate states like "1." survive typing
  const [cfgText, setCfgText] = useState('1.0')
  const cfg = Math.min(2, Math.max(1, Number(cfgText) || 1))
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { events, done, job, result } = useJobStream(jobId)

  const latest = useMemo(() => lastStageEvent(events), [events])
  const elapsed = useElapsed(jobId, done)

  async function submit() {
    setError(null)
    if (!title.trim()) {
      setError('请先给作品起个歌名')
      return
    }
    setSubmitting(true)
    try {
      const seed = seedText.trim() === '' ? null : Number(seedText)
      const res = await api<{ job_id: string; project_id: string }>('/generate', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), style, lyrics, cot, seed, cfg_scale: cfg }),
      })
      setJobId(res.job_id)
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-5 p-5 lg:grid-cols-[420px_1fr]">
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Music4 size={15} /> 新建作品</span>} desc="歌词 + 风格 → 完整歌曲(人声 + 伴奏)" />
        <CardBody className="space-y-4">
          <div>
            <Label hint="必填,可以重名">歌名</Label>
            <Input
              value={title}
              placeholder="给这首作品起个名字"
              maxLength={60}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <Label hint="描述曲风、人声、乐器、氛围">风格</Label>
            <Textarea rows={3} value={style} onChange={(e) => setStyle(e.target.value)} />
          </div>
          <div>
            <Label hint="[Verse] [Chorus] 等段落标记">歌词</Label>
            <Textarea rows={9} value={lyrics} onChange={(e) => setLyrics(e.target.value)} className="font-mono text-[13px]" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>规划模式</Label>
              <SelectMenu
                value={cot}
                onChange={(v) => setCot(v as typeof cot)}
                options={[
                  { value: 'full', label: 'full · 旋律+和弦' },
                  { value: 'melody', label: 'melody · 仅旋律' },
                  { value: 'off', label: 'off · 直接生成' },
                ]}
              />
            </div>
            <div>
              <Label>Seed</Label>
              <Input value={seedText} placeholder="随机" onChange={(e) => setSeedText(e.target.value.replace(/[^0-9]/g, ''))} />
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
          {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
          <Button className="w-full" onClick={submit} disabled={submitting || !!jobId && !done || !title.trim()}>
            {jobId && !done ? <Loader2 className="animate-spin" size={15} /> : <Sparkles size={15} />}
            {jobId && !done ? '生成中…' : '生成歌曲'}
          </Button>
        </CardBody>
      </Card>

      <div className="space-y-5">
        {!jobId && <EmptyState />}
        {jobId && <JobPanel jobId={jobId} latest={latest} events={events} elapsed={elapsed} done={done} />}
        {done && result && <ResultCard result={result as GenResult} job={job} />}
      </div>
    </div>
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
  return (
    <Card className="flex h-full min-h-[420px] items-center justify-center">
      <div className="text-center text-sm text-zinc-500">
        <Music4 size={40} className="mx-auto mb-3 text-zinc-700" />
        填好风格和歌词,点"生成歌曲"
        <div className="mt-1 text-xs text-zinc-600">整曲生成约 1~2 分钟,进度实时显示在右侧</div>
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
  const start = events[0]?.t ?? Date.now() / 1000
  const secs = Math.max(0, Math.round(elapsed / 1000 - start))
  return (
    <Card>
      <CardHeader
        title="生成进度"
        desc={`job ${jobId}`}
        right={<Badge status={done ? latest?.status ?? 'done' : 'running'} />}
      />
      <CardBody className="space-y-3">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium text-zinc-200">
            {latest ? STAGE_LABEL[latest.stage ?? ''] ?? latest.stage : '排队中…'}
          </span>
          <span className="text-xs text-zinc-500">{done ? '完成' : `${secs}s`}</span>
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
          <summary className="cursor-pointer select-none">事件流 ({events.length})</summary>
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
  const [libJob, setLibJob] = useState<string | null>(null)
  const libStream = useJobStream(libJob)
  return (
    <Card>
      <CardHeader
        title="生成完成"
        desc={`${result.duration}s · seed ${result.seed} · v${result.v}`}
        right={
          <Link to={`/projects/${result.project_id}`} className="text-xs text-emerald-400 hover:underline">
            打开项目 →
          </Link>
        }
      />
      <CardBody className="space-y-3">
        <AudioPlayer url={result.urls.audio} />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <a className="text-zinc-400 hover:text-emerald-400" href={result.urls.audio} download>下载 FLAC</a>
          <a className="text-zinc-400 hover:text-emerald-400" href={result.urls.abc} target="_blank" rel="noreferrer">查看 ABC 乐谱</a>
          {job?.error && <span className="text-red-400">{job.error}</span>}
          <span className="flex-1" />
          <Button size="sm" variant="outline" disabled={!!libJob && !libStream.done}
            onClick={() => api<{ job_id: string }>('/library/import-version', {
              method: 'POST',
              body: JSON.stringify({ version_id: result.version_id }),
            }).then((r) => setLibJob(r.job_id)).catch((e) => alert(String(e)))}
            title="加入音乐库(自动分析打标)">
            {libJob && !libStream.done ? <Loader2 className="animate-spin" size={13} /> : <LibraryBig size={13} />} 加入音乐库
          </Button>
        </div>
        {libJob && !libStream.done && <div className="text-xs text-zinc-500">正在分析入库…(MERT 特征 + 标签)</div>}
        {libStream.done && libStream.job?.result && (
          <div className="text-xs text-emerald-400">已加入音乐库,<Link to="/library" className="hover:underline">去查看 →</Link></div>
        )}
      </CardBody>
    </Card>
  )
}
