import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Gauge, Loader2, RefreshCw, Trophy } from 'lucide-react'
import { api } from '@/lib/api'
import { useJobStream } from '@/lib/job'
import { JobPanel } from '@/components/JobPanel'
import { Badge, Button, Card, CardBody, CardHeader, Page } from '@/components/ui'

type Row = {
  version_id: string
  project_id: string
  project: string
  v: number
  note: string
  source: string
  duration?: number | null
  metrics: {
    intelligibility?: number | null
    coherence?: number | null
    vae_recon_snr_db?: number | null
    clip_ratio?: number | null
  } | null
  score?: number | null
}

export function LeaderboardPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [jobId, setJobId] = useState<string | null>(null)
  const { events, done } = useJobStream(jobId)

  const refresh = useCallback(() => {
    api<Row[]>('/leaderboard').then(setRows).catch(() => {}).finally(() => setLoading(false))
  }, [])
  useEffect(refresh, [refresh])
  useEffect(() => {
    if (done && jobId) {
      setJobId(null)
      refresh()
    }
  }, [done, jobId, refresh])

  const latest = events[events.length - 1]
  const pending = rows.filter((r) => !r.metrics).length

  return (
    <Page className="flex h-full flex-col">
      <Card className="shrink-0">
        <CardHeader
          title="评测排行榜"
          right={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={refresh}><RefreshCw size={13} /> 刷新</Button>
              <Button
                size="sm"
                disabled={pending === 0 || (!!jobId && !done)}
                onClick={() => api<{ job_id: string }>('/evaluate/batch?limit=8', { method: 'POST' }).then((r) => setJobId(r.job_id)).catch((e) => alert(String(e)))}
              >
                {jobId && !done ? <Loader2 className="animate-spin" size={13} /> : <Gauge size={13} />}
                评测缺失版本{pending > 0 ? `(${pending})` : ''}
              </Button>
            </div>
          }
        />
      </Card>

      {jobId && !done && <JobPanel jobId={jobId} events={events} done={done} title="批量评测" failedNote={latest?.detail} />}

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader
          title="全部版本 · 复合分排名"
          desc="0.45×歌词清晰度 + 0.30×结构连贯性 + 0.20×重构SNR + 0.05×低削波 —— 代理指标,最终以人耳为准"
        />
        <CardBody className="min-h-0 flex-1 overflow-y-auto p-0">
          {loading && <div className="p-4 text-sm text-zinc-500">加载中…</div>}
          {!loading && rows.length === 0 && <div className="p-4 text-sm text-zinc-500">还没有版本,去创作一首。</div>}
          {rows.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-zinc-900 text-zinc-400">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">作品</th>
                  <th className="px-3 py-2">版本</th>
                  <th className="px-3 py-2">清晰度</th>
                  <th className="px-3 py-2">连贯性</th>
                  <th className="px-3 py-2">SNR</th>
                  <th className="px-3 py-2">削波</th>
                  <th className="px-3 py-2">综合分</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.version_id} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                    <td className="px-3 py-2 font-mono text-zinc-500">
                      {i < 3 && r.score != null ? <Trophy size={12} className={i === 0 ? 'text-yellow-400' : i === 1 ? 'text-zinc-300' : 'text-amber-600'} /> : i + 1}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2">
                      <Link to={`/projects/${r.project_id}`} className="text-zinc-200 hover:text-emerald-400">{r.project}</Link>
                      <span className="ml-2 text-zinc-500">{r.note || r.source}</span>
                    </td>
                    <td className="px-3 py-2 text-center"><Badge status="done">v{r.v}</Badge></td>
                    <td className="px-3 py-2 text-center font-mono">{r.metrics?.intelligibility ?? '—'}</td>
                    <td className="px-3 py-2 text-center font-mono">{r.metrics?.coherence ?? '—'}</td>
                    <td className="px-3 py-2 text-center font-mono">{r.metrics?.vae_recon_snr_db ?? '—'}</td>
                    <td className="px-3 py-2 text-center font-mono">{r.metrics?.clip_ratio ?? '—'}</td>
                    <td className="px-3 py-2 text-center font-mono text-emerald-400">{r.score ?? '未评测'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </Page>
  )
}
