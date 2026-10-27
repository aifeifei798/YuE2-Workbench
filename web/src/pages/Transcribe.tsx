import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileAudio, Loader2, Trash2, Upload } from 'lucide-react'
import { api, type UploadAsset } from '@/lib/api'
import { useJobStream } from '@/lib/job'
import { JobPanel } from '@/components/JobPanel'
import { Notation } from '@/components/Notation'
import { UploadPicker } from '@/components/UploadPicker'
import { Button, Card, CardBody, CardHeader, Label, Page, Select } from '@/components/ui'

type TranscribeResult = {
  abc: string
  melody_only: boolean
  files: Record<string, string>
  summary: {
    keys?: { t?: number; key?: string }[]
    n_chords?: number
    chords_head?: string[]
    tempo?: number | null
    duration?: number | null
  }
}
type TranscribeRun = { run_id: string; created_at: number; has_score: boolean; melody_only: boolean; n_files: number }
type UploadedRef = { id?: string; path: string; filename: string }

export function TranscribePage() {
  const [sp, setSp] = useSearchParams()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploaded, setUploaded] = useState<UploadedRef | null>(null)
  const [uploading, setUploading] = useState(false)
  const [melodyOnly, setMelodyOnly] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runs, setRuns] = useState<TranscribeRun[]>([])
  const [restored, setRestored] = useState<TranscribeResult | null>(null)
  const [restoredRun, setRestoredRun] = useState('')
  const [restoring, setRestoring] = useState(false)
  const { events, done, job } = useJobStream(jobId)
  const jobResult = useMemo(
    () => ((job?.result ?? events.find((e) => e.result)?.result) ?? undefined) as TranscribeResult | undefined,
    [job, events],
  )
  const shown = jobId ? (done ? jobResult : undefined) : restored

  const loadRuns = useCallback(async (assetId: string, autoPick = true) => {
    try {
      const list = await api<TranscribeRun[]>(`/uploads/${assetId}/transcriptions`)
      setRuns(list)
      if (autoPick && list.length) {
        setRestoring(true)
        const r = await api<TranscribeResult>(`/uploads/${assetId}/transcriptions/${list[0].run_id}`)
        setRestored(r)
        setRestoredRun('')
        setRestoring(false)
      }
    } catch {
      // 版本列表加载失败不挡扒谱主流程
    }
  }, [])

  function applyUpload(u: { id?: string; path: string; filename: string }) {
    setFile(null)
    setUploaded(u)
    setJobId(null)
    setRestored(null)
    setRestoredRun('')
    setRuns([])
    if (u.id) loadRuns(u.id)
  }

  // 深链 ?u=<upload_id>:素材页"去扒谱"直达,预填并恢复已有结果
  useEffect(() => {
    const want = sp.get('u')
    if (!want) return
    api<UploadAsset[]>('/uploads')
      .then((list) => {
        const u = list.find((x) => x.id === want)
        if (u) applyUpload(u)
        setSp({}, { replace: true })
      })
      .catch(() => setSp({}, { replace: true }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function pick(f: File | null) {
    setFile(f)
    setError(null)
    if (!f) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
      applyUpload(await res.json())
    } catch (e) {
      setError(String(e))
    } finally {
      setUploading(false)
    }
  }

  async function start() {
    if (!uploaded) return
    setError(null)
    setRestored(null)
    try {
      const res = await api<{ job_id: string }>('/transcribe', {
        method: 'POST',
        body: JSON.stringify({ path: uploaded.path, melody_only: melodyOnly }),
      })
      setJobId(res.job_id)
    } catch (e) {
      setError(String(e))
    }
  }

  // 扒谱完成 → 刷新版本列表(新 run 入列)
  useEffect(() => {
    if (done && uploaded?.id) loadRuns(uploaded.id, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done])

  async function pickRun(runId: string) {
    if (!uploaded?.id) return
    setRestoring(true)
    setError(null)
    try {
      const r = await api<TranscribeResult>(`/uploads/${uploaded.id}/transcriptions/${runId}`)
      setRestored(r)
      setRestoredRun(runId)
      setJobId(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setRestoring(false)
    }
  }

  async function deleteRun(runId: string) {
    if (!uploaded?.id || !confirm('删除这个扒谱版本?不提供找回。')) return
    try {
      await api(`/uploads/${uploaded.id}/transcriptions/${runId}`, { method: 'DELETE' })
      const list = await api<TranscribeRun[]>(`/uploads/${uploaded.id}/transcriptions`)
      setRuns(list)
      if (runId === (restoredRun || list[0]?.run_id)) {
        setRestored(null)
        setRestoredRun('')
        if (list.length) await pickRun(list[0].run_id)
      }
    } catch (e) {
      setError(String(e))
    }
  }

  const busy = !!jobId && !done
  const shownRunId = restoredRun || runs[0]?.run_id || ''

  return (
    <Page>
      <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><FileAudio size={15} /> 自动扒谱</span>} desc="歌曲 → 主旋律 + 和弦 + 节拍 + 调性" />
        <CardBody className="space-y-4">
          <input ref={fileRef} type="file" accept="audio/*" aria-label="上传扒谱音频" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; pick(f) }} />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-700 py-8 text-sm text-zinc-400 transition-colors hover:border-emerald-500/50 hover:text-zinc-200"
          >
            {uploading ? <Loader2 className="animate-spin" size={20} /> : <Upload size={20} />}
            {file ? file.name : uploaded ? uploaded.filename : '点击选择音频文件'}
            <span className="text-xs text-zinc-600">mp3 / wav / flac / m4a / webm …</span>
          </button>
          <UploadPicker onPick={applyUpload} hint="选已扒谱的素材会直接载入最后一次结果" />
          {uploaded?.id && runs.length > 0 && (
            <div>
              <Label hint={`共 ${runs.length} 次,当前显示最后一次`}>历史扒谱版本</Label>
              <div className="flex gap-2">
                <Select aria-label="选择扒谱版本" value={shownRunId} disabled={busy || restoring} onChange={(e) => pickRun(e.target.value)}>
                  {runs.map((r) => (
                    <option key={r.run_id} value={r.run_id}>
                      {new Date(r.created_at * 1000).toLocaleString()} · {r.melody_only ? '仅旋律' : '完整'}{r.has_score ? '' : ' · 无ABC'}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="ghost" size="sm" className="h-10 w-10 shrink-0 p-0 text-zinc-500 hover:text-red-400"
                  title="删除当前显示的版本(不提供找回)" disabled={busy || restoring}
                  onClick={() => shownRunId && deleteRun(shownRunId)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" aria-label="仅旋律谱" checked={melodyOnly} onChange={(e) => setMelodyOnly(e.target.checked)} className="accent-emerald-500" />
            仅旋律谱(翻唱用,去掉和弦)
          </label>
          {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
          <Button className="w-full" disabled={!uploaded || busy} onClick={start}>
            重新扒谱
          </Button>
        </CardBody>
      </Card>

      <div className="space-y-5">
        {!jobId && !shown && (
          <Card className="flex min-h-[300px] items-center justify-center">
            <div className="text-center text-sm text-zinc-500">
              {restoring ? <Loader2 className="mx-auto mb-2 animate-spin text-zinc-400" size={18} /> : null}
              {restoring ? '正在载入历史扒谱结果…' : '上传一首歌,这里会出可编辑的 ABC 乐谱'}
              <div className="mt-1 text-xs text-zinc-600">同时输出分轨 MIDI 与节拍/和弦/调性标注;选已扒谱素材秒出上次结果</div>
            </div>
          </Card>
        )}
        {busy && <JobPanel jobId={jobId} events={events} done={done} title="扒谱进度" />}
        {shown && (
          <>
            <Card>
              <CardHeader
                title="转录结果"
                desc={[
                  shown.summary.keys?.[0]?.key && `调性 ${shown.summary.keys[0].key}`,
                  shown.summary.tempo && `${shown.summary.tempo} BPM`,
                  `${shown.summary.n_chords ?? 0} 个和弦`,
                ].filter(Boolean).join(' · ')}
              />
              <CardBody className="space-y-4">
                {shown.abc ? <Notation abc={shown.abc} /> : (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    这个版本没有生成 ABC(素材可能没有可解码的节拍),MIDI/标注仍在下方
                  </div>
                )}
                <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
                  {Object.entries(shown.files).map(([name, url]) => (
                    <a key={name} href={url} download className="hover:text-emerald-400">
                      {name}
                    </a>
                  ))}
                </div>
              </CardBody>
            </Card>
            {!!shown.summary.chords_head?.length && (
              <Card>
                <CardHeader title="和弦进行" />
                <CardBody className="flex flex-wrap gap-1.5">
                  {shown.summary.chords_head.map((c, i) => (
                    <span key={i} className="rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 font-mono text-xs text-zinc-300">{c}</span>
                  ))}
                </CardBody>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
    </Page>
  )
}
