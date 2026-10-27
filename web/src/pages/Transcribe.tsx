import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileAudio, Loader2, Upload } from 'lucide-react'
import { api, type UploadAsset } from '@/lib/api'
import { useJobStream } from '@/lib/job'
import { JobPanel } from '@/components/JobPanel'
import { Notation } from '@/components/Notation'
import { UploadPicker } from '@/components/UploadPicker'
import { Button, Card, CardBody, CardHeader } from '@/components/ui'

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

export function TranscribePage() {
  const [sp, setSp] = useSearchParams()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploaded, setUploaded] = useState<{ path: string; filename: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [melodyOnly, setMelodyOnly] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { events, done, job } = useJobStream(jobId)
  const result = useMemo(
    () => ((job?.result ?? events.find((e) => e.result)?.result) ?? undefined) as TranscribeResult | undefined,
    [job, events],
  )

  // 深链 ?u=<upload_id>:素材页"去扒谱"直达,预填不自动开跑
  useEffect(() => {
    const want = sp.get('u')
    if (!want) return
    api<UploadAsset[]>('/uploads')
      .then((list) => {
        const u = list.find((x) => x.id === want)
        if (u) setUploaded({ path: u.path, filename: u.filename })
        setSp({}, { replace: true })
      })
      .catch(() => setSp({}, { replace: true }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function pick(f: File | null) {
    setFile(f)
    setUploaded(null)
    setError(null)
    if (!f) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
      setUploaded(await res.json())
    } catch (e) {
      setError(String(e))
    } finally {
      setUploading(false)
    }
  }

  async function start() {
    if (!uploaded) return
    setError(null)
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

  return (
    <div className="mx-auto grid max-w-6xl gap-5 p-5 lg:grid-cols-[380px_1fr]">
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><FileAudio size={15} /> 自动扒谱</span>} desc="歌曲 → 主旋律 + 和弦 + 节拍 + 调性" />
        <CardBody className="space-y-4">
          <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-700 py-8 text-sm text-zinc-400 transition-colors hover:border-emerald-500/50 hover:text-zinc-200"
          >
            {uploading ? <Loader2 className="animate-spin" size={20} /> : <Upload size={20} />}
            {file ? file.name : uploaded ? uploaded.filename : '点击选择音频文件'}
            <span className="text-xs text-zinc-600">mp3 / wav / flac / m4a / webm …</span>
          </button>
          <UploadPicker onPick={(u) => { setFile(null); setUploaded({ path: u.path, filename: u.filename }) }} />
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={melodyOnly} onChange={(e) => setMelodyOnly(e.target.checked)} className="accent-emerald-500" />
            仅旋律谱(翻唱用,去掉和弦)
          </label>
          {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
          <Button className="w-full" disabled={!uploaded || !!jobId && !done} onClick={start}>
            开始扒谱
          </Button>
        </CardBody>
      </Card>

      <div className="space-y-5">
        {!jobId && (
          <Card className="flex min-h-[300px] items-center justify-center">
            <div className="text-center text-sm text-zinc-500">
              上传一首歌,这里会出可编辑的 ABC 乐谱
              <div className="mt-1 text-xs text-zinc-600">同时输出分轨 MIDI 与节拍/和弦/调性标注</div>
            </div>
          </Card>
        )}
        {jobId && !done && <JobPanel jobId={jobId} events={events} done={done} title="扒谱进度" />}
        {done && result && (
          <>
            <Card>
              <CardHeader
                title="转录结果"
                desc={[
                  result.summary.keys?.[0]?.key && `调性 ${result.summary.keys[0].key}`,
                  result.summary.tempo && `${result.summary.tempo} BPM`,
                  `${result.summary.n_chords ?? 0} 个和弦`,
                ].filter(Boolean).join(' · ')}
              />
              <CardBody className="space-y-4">
                <Notation abc={result.abc} />
                <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
                  {Object.entries(result.files).map(([name, url]) => (
                    <a key={name} href={url} download className="hover:text-emerald-400">
                      {name}
                    </a>
                  ))}
                </div>
              </CardBody>
            </Card>
            {!!result.summary.chords_head?.length && (
              <Card>
                <CardHeader title="和弦进行" />
                <CardBody className="flex flex-wrap gap-1.5">
                  {result.summary.chords_head.map((c, i) => (
                    <span key={i} className="rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 font-mono text-xs text-zinc-300">{c}</span>
                  ))}
                </CardBody>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}
