import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Layers, Loader2, Scissors, Upload } from 'lucide-react'
import { api, type ProjectSummary, type UploadAsset } from '@/lib/api'
import { useJobStream } from '@/lib/job'
import { useT } from '@/lib/i18n'
import { JobPanel } from '@/components/JobPanel'
import { AudioPlayer } from '@/components/AudioPlayer'
import { UploadPicker } from '@/components/UploadPicker'
import { Badge, Button, Card, CardBody, CardHeader, Label, Page, Select } from '@/components/ui'

type VersionRow = { id: string; v: number; note: string; source: string; status: string; duration?: number | null; urls?: { audio: string } | null }
type Source = { kind: 'upload'; asset: UploadAsset } | { kind: 'version'; versionId: string }

const STEM_LABEL: Record<string, [string, string]> = {
  vocals: ['人声', 'Vocals'],
  drums: ['鼓', 'Drums'],
  bass: ['贝斯', 'Bass'],
  other: ['其他', 'Other'],
}

export function StemsPage() {
  const t = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const [asset, setAsset] = useState<UploadAsset | null>(null)
  const [uploading, setUploading] = useState(false)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectId, setProjectId] = useState('')
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [versionId, setVersionId] = useState('')
  const [stems, setStems] = useState<Record<string, string> | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { events, done } = useJobStream(jobId)

  const source: Source | null = asset ? { kind: 'upload', asset } : versionId ? { kind: 'version', versionId } : null

  const loadStems = useCallback(async (src: Source | null) => {
    if (!src) {
      setStems(null)
      return
    }
    try {
      const res =
        src.kind === 'upload'
          ? await api<{ stems: Record<string, string> }>(`/uploads/${src.asset.id}/stems`)
          : await api<{ stems: Record<string, string> }>(`/versions/${src.versionId}/stems`)
      setStems(res.stems)
    } catch {
      setStems(null)
    }
  }, [])

  useEffect(() => {
    api<ProjectSummary[]>('/projects').then(setProjects).catch(() => {})
  }, [])

  useEffect(() => { loadStems(source) }, [source, loadStems])

  useEffect(() => {
    if (done && jobId) {
      setJobId(null)
      loadStems(source)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done])

  function pickAsset(u: UploadAsset) {
    setAsset(u)
    setVersionId('')
    setProjectId('')
    setError(null)
  }

  function pickVersion(pid: string, vid?: string) {
    setAsset(null)
    setStems(null)
    setProjectId(pid)
    if (!pid) {
      setVersions([])
      setVersionId('')
      return
    }
    api<{ versions: VersionRow[] }>(`/projects/${pid}`).then((d) => {
      const doneVersions = d.versions.filter((v) => v.status === 'done' && v.urls?.audio)
      setVersions(doneVersions)
      setVersionId(vid && doneVersions.some((v) => v.id === vid) ? vid : doneVersions[0]?.id ?? '')
    }).catch((e) => setError(String(e)))
  }

  async function pick(f: File | null) {
    if (!f) return
    setError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
      pickAsset((await res.json()) as UploadAsset)
    } catch (e) {
      setError(String(e))
    } finally {
      setUploading(false)
    }
  }

  async function start() {
    if (!source) return
    setError(null)
    try {
      const body = source.kind === 'upload' ? { path: source.asset.path } : { version_id: source.versionId }
      const r = await api<{ job_id: string }>('/stems', { method: 'POST', body: JSON.stringify(body) })
      setJobId(r.job_id)
    } catch (e) {
      setError(String(e))
    }
  }

  const busy = !!jobId && !done
  const zipUrl =
    stems && source
      ? source.kind === 'upload'
        ? `/api/uploads/${source.asset.id}/export/stems.zip`
        : `/api/versions/${source.versionId}/export/stems.zip`
      : null

  return (
    <Page>
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Layers size={15} /> {t('分轨', 'Stems')}</span>}
          desc={t('HTDemucs 四轨分离:人声 / 鼓 / 贝斯 / 其他;支持上传、素材库歌曲和项目版本', 'HTDemucs 4-stem separation: vocals / drums / bass / other — from uploads, library assets or project versions')}
        />
        <CardBody className="space-y-4">
          <input ref={fileRef} type="file" accept="audio/*" aria-label="上传分轨音频" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; pick(f) }} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-700 py-7 text-sm text-zinc-400 transition-colors hover:border-emerald-500/50 hover:text-zinc-200 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="animate-spin" size={19} /> : <Upload size={19} />}
            {uploading ? t('上传中…', 'Uploading…') : asset ? asset.filename : t('上传本地歌曲分离', 'Upload a song to separate')}
            <span className="text-xs text-zinc-600">{t('或从素材库 / 项目版本选择', 'or pick from assets / project versions')}</span>
          </button>
          <UploadPicker onPick={pickAsset} hint="选已分轨的素材直接出结果" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label hint={t('项目版本也能分', 'Project versions work too')}>{t('项目', 'Project')}</Label>
              <Select aria-label="选择项目" value={projectId} onChange={(e) => pickVersion(e.target.value)}>
                <option value="">{t('选择项目…', 'Pick a project…')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>{t('版本', 'Version')}</Label>
              <Select aria-label="选择版本" value={versionId} onChange={(e) => { setAsset(null); setVersionId(e.target.value) }}>
                <option value="">{t('选择版本…', 'Pick a version…')}</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{String(v.v).padStart(2, '0')} · {v.note || v.source} · {v.duration ? `${Math.round(v.duration)}s` : '?'}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
          <Button className="w-full" disabled={!source || busy || !!stems} onClick={start}>
            {busy ? <Loader2 className="animate-spin" size={14} /> : <Scissors size={14} />}
            {busy ? t('分离中…', 'Separating…') : stems ? t('已有分轨,结果在下方', 'Already separated — results below') : t('开始分轨', 'Start separation')}
          </Button>
        </CardBody>
      </Card>

      {busy && <JobPanel jobId={jobId} events={events} done={done} title={t('分轨任务', 'Stem separation')} />}

      {stems && source && (
        <Card>
          <CardHeader
            title={t('分离结果', 'Separation results')}
            desc={source.kind === 'upload' ? source.asset.filename : `项目版本 v${versions.find((v) => v.id === source.versionId)?.v ?? ''}`}
            right={
              <a href={zipUrl ?? '#'} download>
                <Button size="sm" variant="outline"><Download size={13} /> {t('分轨 ZIP', 'Stems ZIP')}</Button>
              </a>
            }
          />
          <CardBody className="space-y-3">
            {(['vocals', 'drums', 'bass', 'other'] as const).map((name) =>
              stems[name] ? (
                <div key={name} className="flex items-center gap-3">
                  <Badge status="done">{t(STEM_LABEL[name][0], STEM_LABEL[name][1])}</Badge>
                  <div className="min-w-0 flex-1"><AudioPlayer url={stems[name]} height={48} /></div>
                  <a href={stems[name]} download title={t('下载该轨', 'Download this stem')} className="text-zinc-500 hover:text-emerald-400"><Download size={15} /></a>
                </div>
              ) : null,
            )}
          </CardBody>
        </Card>
      )}
    </Page>
  )
}
