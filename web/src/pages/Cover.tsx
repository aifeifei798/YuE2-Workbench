import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loader2, Mic2, Upload } from 'lucide-react'
import { api, type UploadAsset } from '@/lib/api'
import { useJobStream } from '@/lib/job'
import { JobPanel } from '@/components/JobPanel'
import { Notation } from '@/components/Notation'
import { AudioPlayer } from '@/components/AudioPlayer'
import { UploadPicker } from '@/components/UploadPicker'
import { useT } from '@/lib/i18n'
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, Page, Select, Textarea } from '@/components/ui'

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
type CoverVersion = { project_id: string; title: string; created_at: number; result: CoverPrepareResult | null }

const STYLE_PRESETS = [
  'Jazz-funk, warm lead vocal, Rhodes piano, electric bass, tight drums',
  'Ballad, acoustic guitar, soft female vocal, strings, gentle brush drums',
  'Synthwave, airy male vocal, analog synths, gated drums, wide reverb',
  'Heavy metal, aggressive male vocal, distorted guitars, double kick drums',
]

export function CoverPage() {
  const t = useT()
  const [sp, setSp] = useSearchParams()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [prepareJob, setPrepareJob] = useState<string | null>(null)
  const [genJob, setGenJob] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { events: prepEvents, done: prepDone, job: prepJobRow } = useJobStream(prepareJob)
  const { events: genEvents, done: genDone, job: genJobRow } = useJobStream(genJob)

  const [style, setStyle] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [seed, setSeed] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [pickedUpload, setPickedUpload] = useState<UploadAsset | null>(null)
  const [restoredPrep, setRestoredPrep] = useState<CoverPrepareResult | null>(null)
  const [coverVersions, setCoverVersions] = useState<CoverVersion[]>([])
  const [activeCoverId, setActiveCoverId] = useState('')

  const streamPrep = useMemo(
    () => ((prepJobRow?.result ?? prepEvents.find((e) => e.result)?.result) ?? undefined) as CoverPrepareResult | undefined,
    [prepJobRow, prepEvents],
  )
  // 从素材"已翻唱"恢复的历史结果;新任务开始时清空
  const prepResult = streamPrep ?? restoredPrep ?? undefined
  const genResult = useMemo(
    () => ((genJobRow?.result ?? genEvents.find((e) => e.result)?.result) ?? undefined) as GenResult | undefined,
    [genJobRow, genEvents],
  )

  // 深链 ?u=<upload_id>:素材页"去翻唱"直达;已翻唱载入上次结果,否则自动开始分析
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
    setSourceName(f?.name ?? '')
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
      applyUpload((await up.json()) as UploadAsset)
    } catch (e) {
      setError(String(e))
    } finally {
      setUploading(false)
    }
  }

  const loadCovers = useCallback(async (assetId: string, autoPick = true) => {
    try {
      const list = await api<CoverVersion[]>(`/uploads/${assetId}/covers`)
      setCoverVersions(list)
      if (autoPick) {
        const latest = list[0]
        setActiveCoverId(latest?.project_id ?? '')
        setRestoredPrep(latest?.result ?? null)
      }
    } catch {
      setCoverVersions([])
    }
  }, [])

  // 选素材:已翻唱的直接载入最后一次分析结果,没翻唱过才自动跑分析
  function applyUpload(u: UploadAsset) {
    setPickedUpload(u)
    setFile(null)
    setSourceName(u.filename)
    setGenJob(null)
    setRestoredPrep(null)
    setCoverVersions([])
    setError(null)
    if (u.covers?.length) {
      loadCovers(u.id)
    } else {
      reuseUpload(u)
    }
  }

  async function reuseUpload(u: UploadAsset) {
    setError(null)
    setFile(null)
    setSourceName(u.filename)
    setPrepareJob(null)
    setGenJob(null)
    try {
      const res = await api<{ job_id: string }>('/cover/prepare', {
        method: 'POST',
        body: JSON.stringify({ path: u.path }),
      })
      setPrepareJob(res.job_id)
    } catch (e) {
      setError(String(e))
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
        note: t('翻唱', 'cover'),
      }),
    })
      .then((r) => setGenJob(r.job_id))
      .catch((e) => setError(String(e)))
  }

  function pickCover(pid: string) {
    const c = coverVersions.find((x) => x.project_id === pid)
    if (!c) return
    if (!c.result) {
      setError(t('这个版本的分析结果已失效(任务记录被清理),请在项目页继续或重新分析', 'This version\'s analysis is gone (job records cleaned) — continue on the project page or re-analyze'))
      return
    }
    setError(null)
    setActiveCoverId(pid)
    setGenJob(null)
    setRestoredPrep(c.result)
  }

  async function deleteCover() {
    if (!activeCoverId || !confirm(t('删除这个翻唱版本(整个草稿项目)?不提供找回。', 'Delete this cover version (the whole draft project)? No undo.'))) return
    try {
      await api(`/projects/${activeCoverId}`, { method: 'DELETE' })
      setGenJob(null)
      if (pickedUpload?.id) {
        await loadCovers(pickedUpload.id)
      } else {
        setRestoredPrep(null)
        setActiveCoverId('')
        setCoverVersions([])
      }
    } catch (e) {
      setError(String(e))
    }
  }

  const reviewing = !!prepResult
  const summaryBits = prepResult
    ? [
        prepResult.summary.keys?.[0]?.key && `${t('原调', 'Original key')} ${prepResult.summary.keys[0].key}`,
        prepResult.summary.tempo && `${prepResult.summary.tempo} BPM`,
        prepResult.language,
      ].filter(Boolean)
    : []

  return (
    <Page>
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Mic2 size={15} /> 翻唱 / 风格重制</span>}
          desc={t('老歌 → 分离人声 → 扒旋律谱 → 转歌词 → 校对后换风格重唱', 'Old song → split vocals → score the melody → ASR lyrics → proofread, then re-sing in a new style')}
        />
        <CardBody className="space-y-4">
          <input ref={fileRef} type="file" accept="audio/*" aria-label="上传翻唱歌曲" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; pick(f) }} />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-700 py-8 text-sm text-zinc-400 transition-colors hover:border-emerald-500/50 hover:text-zinc-200"
          >
            {uploading ? <Loader2 className="animate-spin" size={20} /> : <Upload size={20} />}
            {file ? file.name : sourceName || t('点击选择要翻唱的歌曲', 'Click to pick a song to cover')}
            <span className="text-xs text-zinc-600">{t('准备阶段约 1~3 分钟(分轨 + 扒谱 + 歌词识别)', 'Prep takes ~1–3 min (stems + transcription + lyrics ASR)')}</span>
          </button>
          <UploadPicker onPick={applyUpload} hint={t('选已翻唱的素材直接载入上次结果,没翻唱过的自动开始分析', 'Covered assets load their last result; uncovered ones start analyzing automatically')} />
          {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
        </CardBody>
      </Card>

      {prepareJob && !prepDone && (
        <div>
          <JobPanel jobId={prepareJob} events={prepEvents} done={prepDone} title="翻唱准备" />
        </div>
      )}

      {reviewing && prepResult && (
        <>
          {coverVersions.length > 0 && (
            <Card>
              <CardBody className="flex flex-wrap items-end gap-3">
                <div className="min-w-64 flex-1">
                  <Label hint={t(`共 ${coverVersions.length} 次,当前显示最后一次`, `${coverVersions.length} runs; showing the latest`)}>{t('历史翻唱版本', 'Past cover versions')}</Label>
                  <Select aria-label="选择翻唱版本" value={activeCoverId} disabled={!!prepareJob && !prepDone} onChange={(e) => pickCover(e.target.value)}>
                    {coverVersions.map((c) => (
                      <option key={c.project_id} value={c.project_id}>
                        {new Date(c.created_at * 1000).toLocaleString()} · {c.title}{c.result ? '' : ` · ${t('结果已失效', 'result expired')}`}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  variant="outline" size="sm" className="h-9" disabled={!!prepareJob && !prepDone || !pickedUpload}
                  onClick={() => pickedUpload && reuseUpload(pickedUpload)} title="对这个素材重新跑一次分析"
                >
                  {t('重新分析', 'Re-analyze')}
                </Button>
                <Button
                  variant="ghost" size="sm" className="h-9 text-zinc-500 hover:text-red-400" disabled={!!prepareJob && !prepDone || !activeCoverId}
                  onClick={deleteCover} title="删除当前显示的翻唱版本(不提供找回)"
                >
                  {t('删除此版本', 'Delete version')}
                </Button>
              </CardBody>
            </Card>
          )}
          <div className="grid gap-5 lg:grid-cols-2">
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
                desc={t('描述重唱版本的曲风、人声、乐器', 'Describe the style, voice and instruments for the new version')}
                right={<Badge status="queued">{prepResult.language === 'Chinese' ? t('中文', 'Chinese') : t('其他语言', 'Other language')}</Badge>}
              />
              <CardBody className="space-y-3">
                <Textarea aria-label="目标风格" rows={3} value={style} onChange={(e) => setStyle(e.target.value)} placeholder="例:Jazz-funk, warm lead vocal, Rhodes piano…" />
                <div className="flex flex-wrap gap-1.5">
                  {STYLE_PRESETS.map((p, i) => (
                    <button key={i} onClick={() => setStyle(p)} className="rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-emerald-500/50 hover:text-emerald-400">
                      {['爵士放克', '民谣', '合成器浪潮', '重金属'][i]}
                    </button>
                  ))}
                </div>
                <Label hint={t('ASR 原文已预填,改成带 [Verse] / [Chorus] 的分节歌词再生成', 'ASR text is prefilled — split it into [Verse] / [Chorus] sections before generating')}>{t('歌词校对', 'Lyrics proofread')}</Label>
                <Textarea aria-label="歌词" rows={10} value={lyrics} onChange={(e) => setLyrics(e.target.value)} className="font-mono text-[13px]" />
                <div className="flex items-end gap-3">
                  <div className="w-40">
                    <Label>Seed</Label>
                    <Input aria-label="随机种子" value={seed} placeholder="随机" onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))} />
                  </div>
                  <Button className="flex-1" disabled={!style.trim() || !lyrics.trim() || !!genJob && !genDone} onClick={startCover}>
                    {genJob && !genDone ? <Loader2 className="animate-spin" size={15} /> : <Mic2 size={15} />}
                    {genJob && !genDone ? t('重唱生成中…', 'Generating cover…') : t('生成翻唱', 'Generate cover')}
                  </Button>
                </div>
              </CardBody>
            </Card>
          </div>

          {genJob && !genDone && (
            <div>
              <JobPanel jobId={genJob} events={genEvents} done={genDone} title="重唱生成" />
            </div>
          )}
          {genDone && genResult && (
            <Card>
              <CardHeader
                title="翻唱完成"
                desc={`${genResult.duration}s · seed ${genResult.seed}`}
                right={<Link to={`/projects/${genResult.project_id}`} className="text-xs text-emerald-400 hover:underline">{t('打开项目 →', 'Open project →')}</Link>}
              />
              <CardBody>
                <AudioPlayer url={genResult.urls.audio} />
              </CardBody>
            </Card>
          )}
        </>
      )}
    </Page>
  )
}

type GenResult = {
  project_id: string
  duration: number
  seed: number
  urls: { audio: string; abc: string }
}
