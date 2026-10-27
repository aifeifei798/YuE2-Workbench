import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GitCompare, LibraryBig, Loader2, ListMusic, RotateCcw, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react'
import { api, type JobEvent } from '@/lib/api'
import { useJobStream } from '@/lib/job'
import { JobPanel } from '@/components/JobPanel'
import { AudioPlayer } from '@/components/AudioPlayer'
import { Badge, Button, Card, CardBody, CardHeader, Page } from '@/components/ui'
import { useT } from '@/lib/i18n'

type DedupReport = { compared: number; pairs: { a: LibItem; b: LibItem; similarity: number }[] }

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
  const t = useT()
  const navigate = useNavigate()
  const [items, setItems] = useState<LibItem[]>([])
  const [loading, setLoading] = useState(true)
  const [jobId, setJobId] = useState<string | null>(null)
  const [withTranscribe, setWithTranscribe] = useState(true)
  const [similarOf, setSimilarOf] = useState<{ item: LibItem; rows: LibItem[] } | null>(null)
  const [playlist, setPlaylist] = useState<LibItem[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [dedup, setDedup] = useState<DedupReport | null>(null)
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
    } catch (e) {
      alert(String(e))
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
    } catch (e) {
      alert(String(e))
    } finally {
      setBusy(null)
    }
  }

  const allTags = Array.from(new Set(items.flatMap((it) => it.tags))).sort()
  const visible = tagFilter ? items.filter((it) => it.tags.includes(tagFilter)) : items

  return (
    <Page>
      {importing && <JobPanel jobId={jobId!} events={events} done={done} title={t('导入分析', 'Import analysis')} failedNote={latestEvent?.detail} />}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><LibraryBig size={15} /> {t('音乐库', 'Library')}</span>}
          desc={t('MERT 打标 · 相似检索 · 歌单 · 翻唱查重', 'MERT tagging · similar search · playlists · cover dedup')}
          right={
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                <input type="checkbox" aria-label={t('导入时同时扒谱', 'Transcribe on import')} checked={withTranscribe} onChange={(e) => setWithTranscribe(e.target.checked)} className="accent-emerald-500" />
                {t('导入时同时扒谱(调性/速度)', 'Transcribe on import (key/tempo)')}
              </label>
              <input ref={fileRef} type="file" accept="audio/*" aria-label={t('导入歌曲文件', 'Import song file')} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndImport(f); e.target.value = '' }} />
              <Button size="sm" variant="outline" title={t('成对相似度报告,高相似对即疑似翻唱/重复', 'Pairwise similarity report — high pairs are likely covers/duplicates')}
                onClick={() => api<DedupReport>('/library/dedup', { method: 'POST' }).then(setDedup).catch((e) => alert(String(e)))}>
                <GitCompare size={13} /> {t('查重', 'Dedup')}
              </Button>
              <Button size="sm" disabled={busy === 'upload' || importing} onClick={() => fileRef.current?.click()}>
                {busy === 'upload' || importing ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />} {t('导入歌曲', 'Import songs')}
              </Button>
            </div>
          }
        />
        <CardBody className="p-0">
          {loading && <div className="p-4 text-sm text-zinc-500">{t('加载中…', 'Loading…')}</div>}
          {!loading && items.length === 0 && (
            <div className="p-4 text-sm text-zinc-500">{t('空空如也,点右上角导入歌曲。', 'Empty — use Import songs at the top right.')}</div>
          )}
          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800 px-4 py-2.5 text-xs">
          <span className="text-zinc-500">{t('标签:', 'Tags:')}</span>
          <button onClick={() => setTagFilter(null)} className={`rounded-full border px-2.5 py-1 ${!tagFilter ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}>{t('全部', 'All')}</button>
          {allTags.map((t) => (
            <button key={t} onClick={() => setTagFilter(t)} className={`rounded-full border px-2.5 py-1 ${tagFilter === t ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}>{t}</button>
          ))}
        </div>
      )}

      <div className="divide-y divide-zinc-800">
        {visible.map((it) => (
          <div key={it.id} className="px-4 py-3 transition-colors hover:bg-zinc-900/40">
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
                  <Button variant="ghost" size="sm" title={t('以此曲风格创作', 'Create with this style')} className="h-8 w-8 p-0" onClick={() => navigate('/', { state: { refItemId: it.id } })}><Wand2 size={15} /></Button>
                  <Button variant="ghost" size="sm" title={t('重新打标签(探针)', 'Retag (probes)')} className="h-8 w-8 p-0" disabled={busy === `tag:${it.id}`} onClick={() => {
                    setBusy(`tag:${it.id}`)
                    api<{ tags: string[] }>(`/library/${it.id}/retag`, { method: 'POST' })
                      .then(() => refresh())
                      .catch((e) => alert(String(e)))
                      .finally(() => setBusy(null))
                  }}><RotateCcw size={15} /></Button>
                  <Button variant="ghost" size="sm" title={t('找相似', 'Find similar')} className="h-8 w-8 p-0" disabled={busy === `sim:${it.id}`} onClick={() => showSimilar(it)}><Sparkles size={15} /></Button>
                  <Button variant="ghost" size="sm" title={t('生成歌单', 'Make playlist')} className="h-8 w-8 p-0" disabled={busy === `pl:${it.id}`} onClick={() => makePlaylist(it)}><ListMusic size={15} /></Button>
                  <Button variant="ghost" size="sm" title={t('删除', 'Delete')} className="h-8 w-8 p-0" onClick={() => api(`/library/${it.id}`, { method: 'DELETE' }).then(refresh).catch((e) => alert(String(e)))}><Trash2 size={15} /></Button>
                </div>
              </div>
              <div className="mt-2"><AudioPlayer url={it.audio_url} height={44} /></div>
          </div>
        ))}
      </div>
        </CardBody>
      </Card>

      {dedup && (
        <Card>
          <CardHeader
            title={t(`翻唱/重复检测(${dedup.compared} 首,阈值 0.85)`, `Cover/duplicate check (${dedup.compared} songs, threshold 0.85)`)}
            right={<button className="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setDedup(null)}>{t('收起', 'Collapse')}</button>}
          />
          <CardBody className="space-y-1">
            {dedup.pairs.length === 0 && <div className="text-xs text-zinc-500">{t('没有发现高相似对', 'No high-similarity pairs found')}</div>}
            {dedup.pairs.map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-800/60">
                <span className="truncate text-zinc-200">{p.a.title} ↔ {p.b.title}</span>
                <span className="font-mono text-xs text-amber-400">{(p.similarity * 100).toFixed(1)}%</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {similarOf && (
        <Card>
          <CardHeader title={t(`与「${similarOf.item.title}」相似`, `Similar to “${similarOf.item.title}”`)} right={<button className="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setSimilarOf(null)}>{t('收起', 'Collapse')}</button>} />
          <CardBody className="space-y-1">
            {similarOf.rows.length === 0 && <div className="text-xs text-zinc-500">{t('库里没有可比对的其它歌曲', 'No other songs in the library to compare')}</div>}
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
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Sparkles size={15} className="text-emerald-400" /> {t('生成的歌单(相似 + 多样性)', 'Generated playlist (similar + diverse)')}</span>}
            right={<button className="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setPlaylist(null)}>{t('收起', 'Collapse')}</button>}
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
    </Page>
  )
}
