import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Disc3, Loader2, RefreshCw, Scissors, Upload, X } from 'lucide-react'
import { api, type UploadAsset } from '@/lib/api'
import { useJobStream } from '@/lib/job'
import { useT } from '@/lib/i18n'
import { JobPanel } from '@/components/JobPanel'
import { UploadPicker } from '@/components/UploadPicker'
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, Page, Select } from '@/components/ui'

type ProjectSummary = { id: string; title: string }
type VersionRow = {
  id: string
  v: number
  note: string
  source: string
  status: string
  duration?: number | null
  urls?: { audio: string } | null
}
type VersionDetail = VersionRow & { has_stems: boolean; project_id: string }
type PresetsOut = {
  names: string[]
  presets: Record<string, Record<string, number>>
  defaults: Record<string, number>
}
type PreviewOut = {
  url: string
  original_url: string
  vocal_url: string | null
  music_url: string | null
  stats: {
    lufs_before: number
    lufs_after: number
    peak_before_db: number
    peak_after_db: number
    vocal_ratio_db: number
  }
  mode: 'stems' | 'mix_only'
  duration: number
}
type MasterJobResult = { version_id: string; v: number; project_id: string; stats?: Record<string, unknown> }

const CUSTOM = '__custom'

const SLIDERS: { key: string; label: [string, string]; min: number; max: number; step: number; unit: string; hint?: [string, string] }[] = [
  { key: 'vocal_gain_db', label: ['人声电平', 'Vocal level'], min: -6, max: 6, step: 0.5, unit: ' dB' },
  { key: 'mud_db', label: ['浑浊清理', 'De-mud'], min: -8, max: 0, step: 0.5, unit: ' dB', hint: ['320 Hz', '320 Hz'] },
  { key: 'warmth_db', label: ['温暖感', 'Warmth'], min: 0, max: 6, step: 0.5, unit: ' dB', hint: ['180 Hz 低架', '180 Hz low shelf'] },
  { key: 'presence_db', label: ['存在感', 'Presence'], min: 0, max: 8, step: 0.5, unit: ' dB', hint: ['2.5 kHz', '2.5 kHz'] },
  { key: 'air_db', label: ['空气感', 'Air'], min: 0, max: 8, step: 0.5, unit: ' dB', hint: ['8 kHz 高架', '8 kHz high shelf'] },
  { key: 'deesser_amount', label: ['齿音抑制', 'De-esser'], min: 0, max: 2, step: 0.1, unit: '' },
  { key: 'comp_ratio', label: ['人声压缩比', 'Vocal compression'], min: 1, max: 4, step: 0.1, unit: ':1' },
  { key: 'doubling_db', label: ['加厚', 'Doubling'], min: -60, max: -10, step: 1, unit: ' dB', hint: ['每个 double;-60 = 关。耳机监听建议调低', 'Per double; -60 = off. Turn down on headphones'] },
  { key: 'reverb_wet', label: ['混响湿度', 'Reverb wet'], min: 0, max: 0.5, step: 0.01, unit: '', hint: ['生成曲一般保持 0', 'Usually keep at 0 for generated songs'] },
  { key: 'music_gain_db', label: ['伴奏电平', 'Backing level'], min: -6, max: 3, step: 0.5, unit: ' dB' },
  { key: 'duck_db', label: ['侧链闪避', 'Sidechain duck'], min: 0, max: 10, step: 0.5, unit: ' dB', hint: ['人声频段 250-4k', 'vocal band 250–4k'] },
  { key: 'target_lufs', label: ['目标响度', 'Target loudness'], min: -20, max: -8, step: 0.5, unit: ' LUFS' },
]

export function MasterPage() {
  const t = useT()
  const [sp, setSp] = useSearchParams()
  const fileRef = useRef<HTMLInputElement>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [presets, setPresets] = useState<PresetsOut | null>(null)
  const [projectId, setProjectId] = useState('')
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [versionId, setVersionId] = useState('')
  const [detail, setDetail] = useState<VersionDetail | null>(null)
  const [upload, setUpload] = useState<{ id: string; path: string; filename: string; url: string; duration: number } | null>(null)
  const [uploading, setUploading] = useState(false)

  const [preset, setPreset] = useState<string>(CUSTOM)
  const [params, setParams] = useState<Record<string, number>>({})
  const [region, setRegion] = useState<[number, number]>([0, 15])

  const [preview, setPreview] = useState<PreviewOut | null>(null)
  const [previewDirty, setPreviewDirty] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [ab, setAb] = useState<'A' | 'B'>('B')
  const [solo, setSolo] = useState<'mix' | 'vocal' | 'music'>('mix')

  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [exportJob, setExportJob] = useState<string | null>(null)
  const [stemsJob, setStemsJob] = useState<string | null>(null)
  const exportStream = useJobStream(exportJob)
  const stemsStream = useJobStream(stemsJob)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingSeek = useRef(0)
  const renderPreviewRef = useRef<(rg?: [number, number]) => void>(() => {})

  // ---- 数据加载 ----
  useEffect(() => {
    api<ProjectSummary[]>('/projects').then(setProjects).catch((e) => setError(String(e)))
    api<PresetsOut>('/master/presets').then((p) => {
      setPresets(p)
      setParams(p.presets['中性 (只修问题)'] ?? p.defaults)
      setPreset('中性 (只修问题)')
    })
  }, [])

  const loadProject = useCallback((pid: string, preferVersion?: string) => {
    setProjectId(pid)
    if (!pid) {
      setVersions([])
      return
    }
    api<{ versions: VersionRow[] }>(`/projects/${pid}`).then((d) => {
      const done = d.versions.filter((v) => v.status === 'done' && v.urls?.audio)
      setVersions(done)
      const target = preferVersion && done.some((v) => v.id === preferVersion) ? preferVersion : done[0]?.id
      if (target) setVersionId(target)
    }).catch((e) => setError(String(e)))
  }, [])

  // ---- 上传本地歌曲(path 模式) ----
  function readDuration(url: string): Promise<number> {
    return new Promise((resolve) => {
      const a = new Audio()
      a.preload = 'metadata'
      // 有些下载的 webm 元数据不完整,5s 读不到就放弃,时长未知不挡母带流程
      const timer = setTimeout(() => resolve(0), 5000)
      a.onloadedmetadata = () => { clearTimeout(timer); resolve(isFinite(a.duration) ? a.duration : 0) }
      a.onerror = () => { clearTimeout(timer); resolve(0) }
      a.src = url
    })
  }

  async function pickFile(f: File | null) {
    if (!f) return
    setError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const up = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!up.ok) throw new Error(`${up.status} ${await up.text()}`)
      const meta = (await up.json()) as { id: string; path: string; url: string; filename: string }
      const duration = await readDuration(meta.url)
      setUpload({ id: meta.id, path: meta.path, url: meta.url, filename: meta.filename ?? f.name, duration })
      setVersionId('')
      setDetail(null)
      setExportJob(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setUploading(false)
    }
  }

  function pickUpload(u: UploadAsset) {
    setUpload({ id: u.id, path: u.path, filename: u.filename, url: u.url ?? '', duration: u.duration ?? 0 })
    setVersionId('')
    setDetail(null)
    setExportJob(null)
  }

  // 深链 ?v=<version_id> / ?u=<upload_id>
  useEffect(() => {
    const wantU = sp.get('u')
    const wantV = sp.get('v')
    if (wantU) {
      api<UploadAsset[]>('/uploads')
        .then((list) => {
          const u = list.find((x) => x.id === wantU)
          if (u) pickUpload(u)
          setSp({}, { replace: true })
        })
        .catch(() => setSp({}, { replace: true }))
    } else if (wantV) {
      api<VersionDetail>(`/versions/${wantV}`)
        .then((d) => {
          loadProject(d.project_id, wantV)
          setSp({}, { replace: true })
        })
        .catch(() => setSp({}, { replace: true }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!versionId) {
      setDetail(null)
      return
    }
    setPreview(null)
    setPreviewDirty(false)
    api<VersionDetail>(`/versions/${versionId}`).then((d) => setDetail(d))
  }, [versionId])

  // 上传切换时清掉旧预览(自动预览由下方 source effect 接管)
  useEffect(() => {
    setPreview(null)
    setPreviewDirty(false)
  }, [upload?.path])

  const hasSource = !!(detail || upload)
  const activeDuration = upload ? upload.duration : detail?.duration ?? 0
  const needsStems = detail ? !detail.has_stems : preview?.mode === 'mix_only'

  // ---- 预览 ----
  const renderPreview = useCallback(
    async (rg?: [number, number]) => {
      if ((!versionId && !upload) || !presets) return
      setPreviewLoading(true)
      setError(null)
      try {
        const res = await api<PreviewOut>('/master/preview', {
          method: 'POST',
          body: JSON.stringify({
            version_id: upload ? undefined : versionId || undefined,
            path: upload?.path,
            region: rg ?? region,
            preset: preset === CUSTOM ? null : preset,
            overrides: params,
          }),
        })
        setPreview(res)
        setPreviewDirty(false)
      } catch (e) {
        setError(String(e))
      } finally {
        setPreviewLoading(false)
      }
    },
    [versionId, upload, presets, region, preset, params],
  )
  renderPreviewRef.current = renderPreview

  // 选定来源(版本或上传,且预设就绪)后:定位中间 15s 并自动预览一次
  useEffect(() => {
    if ((!detail && !upload) || !presets) return
    const dur = activeDuration
    const mid = dur / 2
    const rg: [number, number] = [Math.max(0, mid - 7.5), Math.max(15, Math.min(dur || 15, mid + 7.5))]
    setRegion(rg)
    renderPreviewRef.current(rg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id, upload?.path, upload?.duration, presets])

  function updateParam(key: string, value: number) {
    setParams((p) => ({ ...p, [key]: value }))
    setPreset((cur) => (cur === CUSTOM ? cur : CUSTOM))
    setPreviewDirty(true)
  }

  function pickPreset(name: string) {
    setPreset(name)
    if (name !== CUSTOM && presets) {
      setParams(presets.presets[name] ?? presets.defaults)
      setPreviewDirty(true)
    }
  }

  // ---- A/B 播放:切源保位置 ----
  const src = useMemo(() => {
    if (!preview) return null
    if (ab === 'A') return preview.original_url
    if (solo === 'vocal') return preview.vocal_url ?? preview.url
    if (solo === 'music') return preview.music_url ?? preview.url
    return preview.url
  }, [preview, ab, solo])

  useEffect(() => {
    const a = audioRef.current
    if (!a || !src) return
    const wasPlaying = !a.paused
    pendingSeek.current = a.currentTime || 0
    a.src = src
    if (wasPlaying) a.play().catch(() => {})
  }, [src])

  function onLoadedMetadata() {
    const a = audioRef.current
    if (a && pendingSeek.current > 0.05 && isFinite(a.duration)) {
      a.currentTime = Math.min(pendingSeek.current, Math.max(0, a.duration - 0.05))
      pendingSeek.current = 0
    }
  }

  // ---- 分轨 / 导出 ----
  async function runStems() {
    if (!versionId && !upload) return
    try {
      const r = await api<{ job_id: string }>('/stems', {
        method: 'POST',
        body: JSON.stringify(upload ? { path: upload.path } : { version_id: versionId }),
      })
      setStemsJob(r.job_id)
    } catch (e) {
      setError(String(e))
    }
  }
  useEffect(() => {
    if (stemsStream.done && stemsJob) {
      setStemsJob(null)
      // 分轨完成:版本刷新 has_stems;上传直接重渲染预览(新分轨进入缓存键)
      if (upload) renderPreviewRef.current()
      else if (versionId) api<VersionDetail>(`/versions/${versionId}`).then(setDetail)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stemsStream.done])

  async function exportMaster() {
    if (!versionId && !upload) return
    setError(null)
    try {
      const presetPart = {
        preset: preset === CUSTOM ? null : preset,
        overrides: params,
        note: note.trim() || undefined,
      }
      let body: Record<string, unknown>
      if (upload) {
        // path 模式:挂到已选项目;没选就按文件名自动建一个,母带照常落成新版本
        let pid = projectId
        if (!pid) {
          const created = await api<{ id: string }>('/projects', {
            method: 'POST',
            body: JSON.stringify({ title: upload.filename.replace(/\.[^.]+$/, '').slice(0, 60) || '上传母带' }),
          })
          pid = created.id
          api<ProjectSummary[]>('/projects').then(setProjects)
          loadProject(pid)
        }
        body = { path: upload.path, project_id: pid, upload_id: upload.id, ...presetPart }
      } else {
        body = { version_id: versionId, ...presetPart }
      }
      const r = await api<{ job_id: string }>('/master', { method: 'POST', body: JSON.stringify(body) })
      setExportJob(r.job_id)
    } catch (e) {
      setError(String(e))
    }
  }

  const exportResult = exportStream.job?.result as MasterJobResult | undefined
  const masteredChildren = versions.filter(
    (v) => v.source === 'master' && detail && (v as { config?: { master?: { source_version_id?: string } } }).config?.master?.source_version_id === detail.id,
  )

  const fmt = (v: number | null | undefined, digits = 1) => (v == null ? '—' : v.toFixed(digits))

  return (
    <Page>
      {/* 源选择 */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Disc3 size={15} /> {t('母带处理', 'Mastering')}</span>}
          desc={t('借鉴 BSV 修复链:去削波 → 人声/配乐分别 EQ·齿音·压缩·闪避·加厚 → 限制器 → 响度归一;可选项目版本或直接上传歌曲', 'BSV repair chain: de-clip → per-stem EQ · de-ess · compression · duck · doubling → limiter → loudness; pick a project version or upload a song')}
        />
        <CardBody className="space-y-3">
          <input ref={fileRef} type="file" accept="audio/*" aria-label="上传歌曲文件" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; pickFile(f) }} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-700 py-4 text-sm text-zinc-400 transition-colors hover:border-emerald-500/50 hover:text-zinc-200 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="animate-spin" size={17} /> : <Upload size={17} />}
            {uploading
              ? t('上传中…', 'Uploading…')
              : upload
                ? <span className="flex items-center gap-2 text-zinc-200">
                    {upload.filename} · {upload.duration > 0 ? `${Math.round(upload.duration)}s` : t('时长未知', 'length unknown')}
                    <span
                      role="button"
                      aria-label={t('清除上传', 'Clear upload')}
                      title={t('清除上传', 'Clear upload')}
                      className="rounded p-0.5 hover:bg-zinc-800"
                      onClick={(e) => { e.stopPropagation(); setUpload(null) }}
                    >
                      <X size={13} />
                    </span>
                  </span>
                : t('上传本地歌曲母带(mp3 / wav / flac …,或选择下方项目版本)', 'Upload a song to master (mp3 / wav / flac …, or pick a project version below)')}
          </button>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label hint={t('上传的文件导出时自动按文件名建项目', 'Uploaded files auto-create a project on export')}>{t('项目', 'Project')}</Label>
              <Select aria-label="选择项目" value={projectId} onChange={(e) => { setVersionId(''); setUpload(null); loadProject(e.target.value) }}>
                <option value="">{t('选择项目…', 'Pick a project…')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label hint={detail ? (detail.has_stems ? t('已有分轨', 'stems ready') : t('未分轨(整轨打磨模式)', 'no stems (whole-track mode)')) : undefined}>版本</Label>
              <Select aria-label="选择版本" value={versionId} onChange={(e) => { setUpload(null); setVersionId(e.target.value) }}>
                <option value="">选择版本…</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{String(v.v).padStart(2, '0')} · {v.note || v.source} · {v.duration ? `${Math.round(v.duration)}s` : '?'}
                    {v.source === 'master' ? ` · ${t('母带', 'master')}` : ''}
                  </option>
                ))}
              </Select>
            </div>
            <UploadPicker onPick={pickUpload} hint={t('素材页统一管理,免重复上传', 'Managed on the assets page — no re-uploading')} />
          </div>
        </CardBody>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      {hasSource && (
        <>
          {/* 预设与参数 */}
          <Card>
            <CardHeader
              title={t('预设与参数', 'Preset & parameters')}
              desc={
                detail
                  ? detail.has_stems
                    ? t('分轨可用:人声链 + 配乐链分别处理', 'Stems available: vocal chain and music chain processed separately')
                    : t('没有分轨:整轨打磨模式(先跑分轨效果更好)', 'No stems: whole-track mode (run separation first for better results)')
                  : t('上传文件:没有分轨时先整轨打磨,点"分轨"跑一次效果更好', 'Uploaded file: whole-track mode — run 分轨 first for better results')
              }
              right={
                needsStems && (
                  <Button size="sm" variant="outline" onClick={runStems} disabled={!!stemsJob}>
                    {stemsJob ? <Loader2 className="animate-spin" size={13} /> : <Scissors size={13} />} {t('分轨', 'Stems')}
                  </Button>
                )
              }
            />
            {stemsJob && <CardBody className="pb-0"><JobPanel jobId={stemsJob} events={stemsStream.events} done={stemsStream.done} title={t('分轨任务', 'Stem separation')} /></CardBody>}
            <CardBody className="space-y-4">
              <div className="max-w-xs">
                <Label>{t('预设', 'Preset')}</Label>
                <Select aria-label={t('选择预设', 'Pick preset')} value={preset} onChange={(e) => pickPreset(e.target.value)}>
                  {presets?.names.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                  <option value={CUSTOM}>{t('自定义(当前参数)', 'Custom (current params)')}</option>
                </Select>
              </div>
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {SLIDERS.map((s) => (
                  <div key={s.key}>
                    <Label hint={s.hint ? t(s.hint[0], s.hint[1]) : undefined}>
                      <span>{t(s.label[0], s.label[1])}</span>
                      <span className="ml-2 font-mono text-[11px] text-emerald-400">
                        {params[s.key] ?? '—'}{s.unit}
                      </span>
                    </Label>
                    <input
                      type="range"
                      aria-label={`${t(s.label[0], s.label[1])}${s.unit}`}
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-emerald-500"
                      min={s.min}
                      max={s.max}
                      step={s.step}
                      value={params[s.key] ?? 0}
                      onChange={(e) => updateParam(s.key, Number(e.target.value))}
                    />
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          {/* 预览 A/B */}
          <Card>
            <CardHeader
              title={t('试听 A / B', 'Audition A / B')}
              desc={t('同一时间点对比:同一位置在原始与母带间切换;母带可 solo 人声 / 配乐', 'Same-position comparison between original and master; solo vocals / music on B')}
              right={
                previewDirty && preview && (
                  <span className="text-[11px] text-amber-400">{t('参数已改,重新渲染预览生效', 'Parameters changed — re-render the preview')}</span>
                )
              }
            />
            <CardBody className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-24">
                  <Label>{t('起点 (s)', 'Start (s)')}</Label>
                  <Input
                    type="number" step={0.5} min={0} aria-label={t('预览起点(秒)', 'Preview start (s)')} value={region[0]}
                    onChange={(e) => setRegion([Number(e.target.value) || 0, region[1]])}
                  />
                </div>
                <div className="w-24">
                  <Label>{t('终点 (s)', 'End (s)')}</Label>
                  <Input
                    type="number" step={0.5} min={0} aria-label={t('预览终点(秒)', 'Preview end (s)')} value={region[1]}
                    onChange={(e) => setRegion([region[0], Number(e.target.value) || 0])}
                  />
                </div>
                <Button variant="outline" size="sm" className="h-9"
                  onClick={() => {
                    const dur = activeDuration
                    const mid = dur / 2
                    const rg: [number, number] = [Math.max(0, mid - 7.5), Math.max(15, Math.min(dur || 15, mid + 7.5))]
                    setRegion(rg)
                    renderPreview(rg)
                  }}
                >{t('中间 15s', 'Middle 15s')}</Button>
                <Button size="sm" className="h-9" onClick={() => renderPreview()} disabled={previewLoading || (!versionId && !upload)}>
                  {previewLoading ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                  {t('渲染预览', 'Render preview')}
                </Button>
              </div>

              {preview && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant={ab === 'A' ? 'default' : 'outline'} onClick={() => setAb('A')}>{t('▶ A 原始', '▶ A Original')}</Button>
                    <Button size="sm" variant={ab === 'B' ? 'default' : 'outline'} onClick={() => setAb('B')}>{t('▶ B 母带', '▶ B Master')}</Button>
                    <span className="mx-1 h-5 w-px bg-zinc-700" />
                    {(['mix', 'vocal', 'music'] as const).map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant={ab === 'B' && solo === s ? 'default' : 'ghost'}
                        disabled={ab !== 'B' || (s !== 'mix' && preview.mode !== 'stems')}
                        onClick={() => setSolo(s)}
                      >
                        {s === 'mix' ? t('混合', 'Mix') : s === 'vocal' ? t('人声', 'Vocals') : t('配乐', 'Music')}
                      </Button>
                    ))}
                    <Badge status={preview.mode === 'stems' ? 'done' : 'queued'}>
                      {preview.mode === 'stems' ? t('分轨双链', 'dual-chain') : t('整轨打磨', 'whole-track')}
                    </Badge>
                  </div>
                  <audio ref={audioRef} src={src ?? undefined} controls onLoadedMetadata={onLoadedMetadata} className="w-full" />
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <Stat label="LUFS" before={preview.stats.lufs_before} after={preview.stats.lufs_after} />
                    <Stat label="峰值 dBFS" before={preview.stats.peak_before_db} after={preview.stats.peak_after_db} />
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                      <div className="text-zinc-500">{t('人声/伴奏比', 'Vocal/backing ratio')}</div>
                      <div className="font-mono text-zinc-200">{fmt(preview.stats.vocal_ratio_db)} dB</div>
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                      <div className="text-zinc-500">{t('试听长度', 'Preview length')}</div>
                      <div className="font-mono text-zinc-200">{preview.duration}s</div>
                    </div>
                  </div>
                </>
              )}
            </CardBody>
          </Card>

          {/* 导出 */}
          <Card>
            <CardHeader
              title={t('导出母带', 'Export master')}
              desc={
                upload
                  ? t('整曲渲染后落成新版本:未选项目时按文件名自动创建;项目版本则乐谱 / 隐变量 / 歌词全部继承', 'Renders the full track into a new version: auto-creates a project from the filename when none is selected')
                  : t('整曲渲染后落成新版本(source=master),乐谱 / 隐变量 / 歌词全部继承,可直接进排行榜与盲听', 'Renders the full track into a new version (source=master) inheriting score / latents / lyrics — straight into the leaderboard and blind test')
              }
            />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-48 flex-1">
                  <Label>{t('版本备注', 'Version note')}</Label>
                  <Input aria-label={t('版本备注', 'Version note')} value={note} placeholder={`${t('母带', 'Master')} (${preset === CUSTOM ? t('自定义', 'custom') : preset})`} onChange={(e) => setNote(e.target.value)} />
                </div>
                <Button onClick={exportMaster} disabled={!hasSource || !!exportJob}>
                  {exportJob ? <Loader2 className="animate-spin" size={14} /> : <Disc3 size={14} />} {t('生成母带版本', 'Create master version')}
                </Button>
              </div>
              {exportJob && (
                <JobPanel jobId={exportJob} events={exportStream.events} done={exportStream.done} title={t('母带任务', 'Mastering job')} />
              )}
              {exportResult && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                  {t('母带完成 →', 'Master done →')} v{String(exportResult.v).padStart(2, '0')} ·
                  <Link className="ml-1 underline" to={`/projects/${exportResult.project_id}`}>{t('在项目页查看', 'open in projects')}</Link>
                  {' · '}
                  <a className="underline" href={`/audio/projects/${exportResult.project_id}/v${String(exportResult.v).padStart(2, '0')}/song.flac`} download>{t('下载 FLAC', 'Download FLAC')}</a>
                </div>
              )}
              {masteredChildren.length > 0 && (
                <div className="text-xs text-zinc-500">
                  {t('该版本已有的母带:', 'Existing masters of this version:')}:{masteredChildren.map((v) => `v${String(v.v).padStart(2, '0')}`).join('、')}
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </Page>
  )
}

function Stat({ label, before, after }: { label: string; before: number; after: number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
      <div className="text-zinc-500">{label}</div>
      <div className="font-mono text-zinc-200">
        {before} → <span className="text-emerald-400">{after}</span>
      </div>
    </div>
  )
}
