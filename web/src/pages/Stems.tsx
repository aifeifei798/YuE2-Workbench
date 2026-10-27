import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Layers, Loader2, Scissors, Upload } from 'lucide-react'
import { api, type ProjectSummary, type UploadAsset } from '@/lib/api'
import { useJobStream } from '@/lib/job'
import { JobPanel } from '@/components/JobPanel'
import { AudioPlayer } from '@/components/AudioPlayer'
import { UploadPicker } from '@/components/UploadPicker'
import { Badge, Button, Card, CardBody, CardHeader, Label, Page, Select } from '@/components/ui'

type VersionRow = { id: string; v: number; note: string; source: string; status: string; duration?: number | null; urls?: { audio: string } | null }
type Source = { kind: 'upload'; asset: UploadAsset } | { kind: 'version'; versionId: string }

const STEM_LABEL: Record<string, string> = { vocals: '人声', drums: '鼓', bass: '贝斯', other: '其他' }

export function StemsPage() {
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
          title={<span className="flex items-center gap-2"><Layers size={15} /> 分轨</span>}
          desc="HTDemucs 四轨分离:人声 / 鼓 / 贝斯 / 其他;支持上传、素材库歌曲和项目版本"
        />
        <CardBody className="space-y-4">
          <input ref={fileRef} type="file" accept="audio/*" aria-label="上传分轨音频" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; pick(f) }} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-700 py-7 text-sm text-zinc-400 transition-colors hover:border-emerald-500/50 hover:text-zinc-200 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="animate-spin" size={19} /> : <Upload size={19} />}
            {uploading ? '上传中…' : asset ? asset.filename : '上传本地歌曲分离'}
            <span className="text-xs text-zinc-600">或从素材库 / 项目版本选择</span>
          </button>
          <UploadPicker onPick={pickAsset} hint="选已分轨的素材直接出结果" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label hint="项目版本也能分">项目</Label>
              <Select aria-label="选择项目" value={projectId} onChange={(e) => pickVersion(e.target.value)}>
                <option value="">选择项目…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>版本</Label>
              <Select aria-label="选择版本" value={versionId} onChange={(e) => { setAsset(null); setVersionId(e.target.value) }}>
                <option value="">选择版本…</option>
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
            {busy ? '分离中…' : stems ? '已有分轨,结果在下方' : '开始分轨'}
          </Button>
        </CardBody>
      </Card>

      {busy && <JobPanel jobId={jobId} events={events} done={done} title="分轨任务" />}

      {stems && source && (
        <Card>
          <CardHeader
            title="分离结果"
            desc={source.kind === 'upload' ? source.asset.filename : `项目版本 v${versions.find((v) => v.id === source.versionId)?.v ?? ''}`}
            right={
              <a href={zipUrl ?? '#'} download>
                <Button size="sm" variant="outline"><Download size={13} /> 分轨 ZIP</Button>
              </a>
            }
          />
          <CardBody className="space-y-3">
            {(['vocals', 'drums', 'bass', 'other'] as const).map((name) =>
              stems[name] ? (
                <div key={name} className="flex items-center gap-3">
                  <Badge status="done" >{STEM_LABEL[name]}</Badge>
                  <div className="min-w-0 flex-1"><AudioPlayer url={stems[name]} height={48} /></div>
                  <a href={stems[name]} download title="下载该轨" className="text-zinc-500 hover:text-emerald-400"><Download size={15} /></a>
                </div>
              ) : null,
            )}
          </CardBody>
        </Card>
      )}
    </Page>
  )
}
