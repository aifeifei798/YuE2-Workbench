import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Mic2, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { useJobStream } from '@/lib/job'
import { JobPanel } from '@/components/JobPanel'
import { Notation } from '@/components/Notation'
import { AudioPlayer } from '@/components/AudioPlayer'
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, Textarea } from '@/components/ui'

type CoverPrepareResult = {
  project_id: string
  abc: string
  abc_files: Record<string, string>
  summary: { keys?: { key?: string }[]; tempo?: number | null; structures?: { label: string }[] }
  lyrics_raw: string
  language?: string
  stems: Record<string, string>
  source_path: string
}

const STYLE_PRESETS = [
  'Jazz-funk, warm lead vocal, Rhodes piano, electric bass, tight drums',
  'Ballad, acoustic guitar, soft female vocal, strings, gentle brush drums',
  'Synthwave, airy male vocal, analog synths, gated drums, wide reverb',
  'Heavy metal, aggressive male vocal, distorted guitars, double kick drums',
]

export function CoverPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [prepareJob, setPrepareJob] = useState<string | null>(null)
  const [genJob, setGenJob] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { events: prepEvents, done: prepDone, job: prepJobRow } = useJobStream(prepareJob)
  const { events: genEvents, done: genDone, job: genJobRow } = useJobStream(genJob)

  const prepResult = useMemo(
    () => ((prepJobRow?.result ?? prepEvents.find((e) => e.result)?.result) ?? undefined) as CoverPrepareResult | undefined,
    [prepJobRow, prepEvents],
  )
  const genResult = useMemo(
    () => ((genJobRow?.result ?? genEvents.find((e) => e.result)?.result) ?? undefined) as GenResult | undefined,
    [genJobRow, genEvents],
  )

  const [style, setStyle] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [seed, setSeed] = useState('')

  async function pick(f: File | null) {
    setFile(f)
    setError(null)
    setPrepareJob(null)
    setGenJob(null)
    if (!f) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const up = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!up.ok) throw new Error(`${up.status} ${await up.text()}`)
      const { path } = await up.json()
      const res = await api<{ job_id: string }>('/cover/prepare', {
        method: 'POST',
        body: JSON.stringify({ path }),
      })
      setPrepareJob(res.job_id)
    } catch (e) {
      setError(String(e))
    } finally {
      setUploading(false)
    }
  }

  function startCover() {
    if (!prepResult) return
    setError(null)
    api<{ job_id: string }>('/generate', {
      method: 'POST',
      body: JSON.stringify({
        project_id: prepResult.project_id,
        style,
        lyrics,
        abc: prepResult.abc,
        cot: 'melody',
        source: 'cover',
        seed: seed.trim() === '' ? null : Number(seed),
        note: '翻唱',
      }),
    })
      .then((r) => setGenJob(r.job_id))
      .catch((e) => setError(String(e)))
  }

  const reviewing = !!prepResult
  const summaryBits = prepResult
    ? [
        prepResult.summary.keys?.[0]?.key && `原调 ${prepResult.summary.keys[0].key}`,
        prepResult.summary.tempo && `${prepResult.summary.tempo} BPM`,
        prepResult.language,
      ].filter(Boolean)
    : []

  return (
    <div className="mx-auto max-w-5xl p-5">
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Mic2 size={15} /> 翻唱 / 风格重制</span>}
          desc="老歌 → 分离人声 → 扒旋律谱 → 转歌词 → 校对后换风格重唱"
        />
        <CardBody className="space-y-4">
          <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-700 py-8 text-sm text-zinc-400 transition-colors hover:border-emerald-500/50 hover:text-zinc-200"
          >
            {uploading ? <Loader2 className="animate-spin" size={20} /> : <Upload size={20} />}
            {file ? file.name : '点击选择要翻唱的歌曲'}
            <span className="text-xs text-zinc-600">准备阶段约 1~3 分钟(分轨 + 扒谱 + 歌词识别)</span>
          </button>
          {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
        </CardBody>
      </Card>

      {prepareJob && !prepDone && (
        <div className="mt-5">
          <JobPanel jobId={prepareJob} events={prepEvents} done={prepDone} title="翻唱准备" />
        </div>
      )}

      {reviewing && prepResult && (
        <>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="旋律谱(melody only)" desc={summaryBits.join(' · ')} />
              <CardBody className="space-y-3">
                <Notation abc={prepResult.abc} height={280} />
                <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
                  {Object.entries(prepResult.abc_files).slice(0, 4).map(([name, url]) => (
                    <a key={name} href={url} download className="hover:text-emerald-400">{name}</a>
                  ))}
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title="目标风格"
                desc="描述重唱版本的曲风、人声、乐器"
                right={<Badge status="queued">{prepResult.language === 'Chinese' ? '中文' : '其他语言'}</Badge>}
              />
              <CardBody className="space-y-3">
                <Textarea rows={3} value={style} onChange={(e) => setStyle(e.target.value)} placeholder="例:Jazz-funk, warm lead vocal, Rhodes piano…" />
                <div className="flex flex-wrap gap-1.5">
                  {STYLE_PRESETS.map((p, i) => (
                    <button key={i} onClick={() => setStyle(p)} className="rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-emerald-500/50 hover:text-emerald-400">
                      {['爵士放克', '民谣', '合成器浪潮', '重金属'][i]}
                    </button>
                  ))}
                </div>
                <Label hint="ASR 原文已预填,改成带 [Verse] / [Chorus] 的分节歌词再生成">歌词校对</Label>
                <Textarea rows={10} value={lyrics} onChange={(e) => setLyrics(e.target.value)} className="font-mono text-[13px]" />
                <div className="flex items-end gap-3">
                  <div className="w-40">
                    <Label>Seed</Label>
                    <Input value={seed} placeholder="随机" onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))} />
                  </div>
                  <Button className="flex-1" disabled={!style.trim() || !lyrics.trim() || !!genJob && !genDone} onClick={startCover}>
                    {genJob && !genDone ? <Loader2 className="animate-spin" size={15} /> : <Mic2 size={15} />}
                    {genJob && !genDone ? '重唱生成中…' : '生成翻唱'}
                  </Button>
                </div>
              </CardBody>
            </Card>
          </div>

          {genJob && !genDone && (
            <div className="mt-5">
              <JobPanel jobId={genJob} events={genEvents} done={genDone} title="重唱生成" />
            </div>
          )}
          {genDone && genResult && (
            <Card className="mt-5">
              <CardHeader
                title="翻唱完成"
                desc={`${genResult.duration}s · seed ${genResult.seed}`}
                right={<Link to={`/projects/${genResult.project_id}`} className="text-xs text-emerald-400 hover:underline">打开项目 →</Link>}
              />
              <CardBody>
                <AudioPlayer url={genResult.urls.audio} />
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

type GenResult = {
  project_id: string
  duration: number
  seed: number
  urls: { audio: string; abc: string }
}
