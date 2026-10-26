import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, ListMusic, Sparkles, Trash2, Upload } from 'lucide-react'
import { api, type JobEvent } from '@/lib/api'
import { useJobStream } from '@/lib/job'
import { JobPanel } from '@/components/JobPanel'
import { AudioPlayer } from '@/components/AudioPlayer'
import { Badge, Button, Card, CardBody, CardHeader } from '@/components/ui'

type LibItem = {
  id: string
  title: string
  artist: string
  duration?: number | null
  key?: string | null
  tempo?: number | null
  structure: { start: number; end: number; label: string }[]
  has_transcription: boolean
  tags: string[]
  audio_url: string
  similarity?: number
}

export function LibraryPage() {
  const [items, setItems] = useState<LibItem[]>([])
  const [loading, setLoading] = useState(true)
  const [jobId, setJobId] = useState<string | null>(null)
  const [withTranscribe, setWithTranscribe] = useState(true)
  const [similarOf, setSimilarOf] = useState<{ item: LibItem; rows: LibItem[] } | null>(null)
  const [playlist, setPlaylist] = useState<LibItem[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { events, done } = useJobStream(jobId)

  const refresh = useCallback(() => {
    api<LibItem[]>('/library').then(setItems).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(refresh, [refresh])

  useEffect(() => {
    if (done && jobId) {
      refresh()
      setJobId(null)
    }
  }, [done, jobId, refresh])

  const importing = !!jobId && !done
  const latestEvent = useMemo<JobEvent | undefined>(() => events[events.length - 1], [events])

  async function uploadAndImport(f: File) {
    setBusy('upload')
    try {
      const fd = new FormData()
      fd.append('file', f)
      const up = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!up.ok) throw new Error(`${up.status} ${await up.text()}`)
      const { path } = await up.json()
      const res = await api<{ job_id: string }>('/library/import', {
        method: 'POST',
        body: JSON.stringify({ path, title: f.name.replace(/\.[^.]+$/, ''), with_transcribe: withTranscribe }),
      })
      setJobId(res.job_id)
    } catch (e) {
      alert(String(e))
    } finally {
      setBusy(null)
    }
  }

  async function showSimilar(item: LibItem) {
    setBusy(`sim:${item.id}`)
    try {
      const rows = await api<LibItem[]>(`/library/${item.id}/similar?k=8`)
      setSimilarOf({ item, rows })
      setPlaylist(null)
    } finally {
      setBusy(null)
    }
  }

  async function makePlaylist(item: LibItem) {
    setBusy(`pl:${item.id}`)
    try {
      const rows = await api<LibItem[]>('/playlist', {
        method: 'POST',
        body: JSON.stringify({ item_id: item.id, n: 10 }),
      })
      setPlaylist(rows)
      setSimilarOf(null)
    } finally {
      setBusy(null)
    }
  }

  const allTags = Array.from(new Set(items.flatMap((it) => it.tags))).sort()
  const visible = tagFilter ? items.filter((it) => it.tags.includes(tagFilter)) : items

  return (
    <div className="mx-auto max-w-6xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">音乐库</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={withTranscribe} onChange={(e) => setWithTranscribe(e.target.checked)} className="accent-emerald-500" />
            导入时同时扒谱(调性/速度)
          </label>
          <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndImport(f); e.target.value = '' }} />
          <Button size="sm" disabled={busy === 'upload' || importing} onClick={() => fileRef.current?.click()}>
            {busy === 'upload' || importing ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />} 导入歌曲
          </Button>
        </div>
      </div>

      {importing && <div className="mb-4"><JobPanel jobId={jobId!} events={events} done={done} title="导入分析" failedNote={latestEvent?.detail} /></div>}

      {loading && <div className="text-sm text-zinc-500">加载中…</div>}
      {!loading && items.length === 0 && (
        <Card><CardBody className="text-sm text-zinc-500">空空如也,点右上角导入歌曲。</CardBody></Card>
      )}

      {allTags.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-zinc-500">标签:</span>
          <button onClick={() => setTagFilter(null)} className={`rounded-full border px-2.5 py-1 ${!tagFilter ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}>全部</button>
          {allTags.map((t) => (
            <button key={t} onClick={() => setTagFilter(t)} className={`rounded-full border px-2.5 py-1 ${tagFilter === t ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}>{t}</button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {visible.map((it) => (
          <Card key={it.id}>
            <CardBody className="py-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-zinc-100">{it.title}</span>
                    {it.artist && <span className="shrink-0 text-xs text-zinc-500">{it.artist}</span>}
                    {it.similarity != null && <Badge status="done">{(it.similarity * 100).toFixed(1)}%</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-zinc-500">
                    {it.duration ? <span>{Math.round(it.duration)}s</span> : null}
                    {it.key && <span className="text-emerald-400/80">{it.key}</span>}
                    {it.tempo ? <span>{it.tempo} BPM</span> : null}
                    {it.tags.map((t) => <span key={t} className="rounded bg-zinc-800 px-1.5 text-zinc-400">{t}</span>)}
                    {it.structure.length > 0 && (
                      <span className="font-mono">{it.structure.map((s) => s.label).join('')}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" disabled={busy === `sim:${it.id}`} onClick={() => showSimilar(it)}>相似</Button>
                  <Button variant="ghost" size="sm" disabled={busy === `pl:${it.id}`} onClick={() => makePlaylist(it)}><ListMusic size={13} /> 歌单</Button>
                  <Button variant="ghost" size="sm" onClick={() => api(`/library/${it.id}`, { method: 'DELETE' }).then(refresh)}><Trash2 size={13} /></Button>
                </div>
              </div>
              <div className="mt-2"><AudioPlayer url={it.audio_url} height={44} /></div>
            </CardBody>
          </Card>
        ))}
      </div>

      {similarOf && (
        <Card className="mt-5">
          <CardHeader title={`与「${similarOf.item.title}」相似`} right={<button className="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setSimilarOf(null)}>收起</button>} />
          <CardBody className="space-y-1">
            {similarOf.rows.length === 0 && <div className="text-xs text-zinc-500">库里没有可比对的其它歌曲</div>}
            {similarOf.rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-800/60">
                <span className="truncate text-zinc-200">{r.title}</span>
                <span className="font-mono text-xs text-emerald-400">{((r.similarity ?? 0) * 100).toFixed(1)}%</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {playlist && (
        <Card className="mt-5">
          <CardHeader
            title={<span className="flex items-center gap-2"><Sparkles size={14} className="text-emerald-400" /> 生成的歌单(相似 + 多样性)</span>}
            right={<button className="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setPlaylist(null)}>收起</button>}
          />
          <CardBody className="space-y-1">
            {playlist.map((r, i) => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-800/60">
                <span className="w-5 text-right font-mono text-xs text-zinc-500">{i + 1}</span>
                <span className="truncate text-zinc-200">{r.title}</span>
                <span className="ml-auto font-mono text-xs text-zinc-500">{((r.similarity ?? 0) * 100).toFixed(1)}%</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  )
}
