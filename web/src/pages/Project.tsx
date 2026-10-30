import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AudioLines, Bot, ChevronLeft, Copy, Disc3, FileSearch, Gauge, Layers, LibraryBig, Loader2, Mic2, Pencil, Play, Scissors, Sparkles, Square, Repeat, PencilRuler, Trash2 } from 'lucide-react'
import { api, type ProjectDetail, type VersionOut } from '@/lib/api'
import { useJobStream } from '@/lib/job'
import { JobPanel } from '@/components/JobPanel'
import { Notation } from '@/components/Notation'
import { AudioPlayer } from '@/components/AudioPlayer'
import { WaveRegionsPlayer, type WaveRegionsHandle } from '@/components/WaveRegionsPlayer'
import { Badge, Button, Card, CardBody, CardHeader, Input, Page, Textarea } from '@/components/ui'
import { SelectMenu } from '@/components/SelectMenu'
import { useT } from '@/lib/i18n'

type PunchCandidate = { idx: number; seed: number; audition_url: string }
type PunchResult = { punch_id: string; region: [number, number]; seconds: number; snapped?: boolean; candidates: PunchCandidate[] }
type GenResult = { version_id: string; project_id: string; v: number; duration: number; seed: number; urls: { audio: string; abc: string } }
type AgentEditResult = {
  instruction: string
  steps: { tool: string; args: Record<string, unknown> }[]
  original_abc: string
  proposed_abc: string
  diff: string
  info_before: { key?: [string, string] | null; tempo?: number | null }
  info_after: { key?: [string, string] | null; tempo?: number | null }
}
type VersionDetail = {
  id: string
  abc_draft: { abc: string; note: string; updated_at: number } | null
  has_transcription: boolean
  has_stems: boolean
  has_beats: boolean
  has_analysis: boolean
  has_cover?: boolean
  project_title: string
}
type TransInfo = {
  abc: string
  files: Record<string, string>
  summary: { keys?: { key?: string }[]; tempo?: number | null; structures?: { label: string }[] }
  n_beats: number
  n_downbeats: number
}
type AgentHistItem = { t: number; instruction: string; steps: { tool: string; args: Record<string, unknown> }[] }
type EvalResult = {
  evals: Record<string, Record<string, unknown>>
  duel: { rows: { metric: string; a: unknown; b: unknown; winner: string | null }[]; auto_suggestion: string } | null
}

export function ProjectPage() {
  const t = useT()
  const { id } = useParams()
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [selected, setSelected] = useState<VersionOut | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  // set when the user deliberately deselects (delete); the 5s poll must not
  // resurrect a selection until they pick a version again
  const suppressAutoSelectRef = useRef(false)

  function startRename() {
    if (!project) return
    setTitleDraft(project.title)
    setEditingTitle(true)
  }

  async function saveRename() {
    if (!project) return
    const t = titleDraft.trim()
    if (!t) return
    try {
      await api(`/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ title: t }) })
      setEditingTitle(false)
      load()
    } catch (e) {
      alert(String(e))
    }
  }

  const load = useCallback(() => {
    if (!id) return
    api<ProjectDetail>(`/projects/${id}`)
      .then((p) => {
        setLoadError(null)
        setProject(p)
        setSelected((cur) => {
          if (cur) return p.versions.find((v) => v.id === cur.id) ?? null
          if (suppressAutoSelectRef.current) return null
          return p.versions.find((v) => v.status === 'done') ?? null
        })
      })
      .catch((e) => setLoadError(String(e)))
  }, [id])

  const selectVersion = useCallback((v: VersionOut | null) => {
    suppressAutoSelectRef.current = v === null
    setSelected(v)
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  if (loadError && !project) return <div className="p-8 text-sm text-red-400">{t('加载失败:', 'Load failed:')} {loadError}</div>
  if (!project) return <div className="p-8 text-sm text-zinc-500">{t('加载中…', 'Loading…')}</div>

  return (
    <Page>
      <div className="flex items-center gap-3">
        <Link to="/projects" className="text-zinc-500 hover:text-zinc-200"><ChevronLeft size={18} /></Link>
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={titleDraft}
                maxLength={80}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveRename()
                  if (e.key === 'Escape') setEditingTitle(false)
                }}
                className="h-9 w-full max-w-md rounded-lg border border-emerald-500/60 bg-zinc-900 px-3 text-base font-semibold text-zinc-100 focus:outline-none"
              />
              <Button size="sm" onClick={saveRename}>{t('保存', 'Save')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingTitle(false)}>{t('取消', 'Cancel')}</Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold">{project.title}</h1>
              <button
                title={t('重命名', 'Rename')}
                onClick={startRename}
                className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-emerald-400"
              >
                <Pencil size={13} />
              </button>
            </div>
          )}
          <div className="truncate text-xs text-zinc-500">{project.style}</div>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        <VersionList project={project} selected={selected} onSelect={selectVersion} />
        <Workspace project={project} version={selected} onRefresh={load} onSelect={selectVersion} />
      </div>
    </Page>
  )
}

const SOURCE_ICON: Record<string, ReactNode> = {
  generated: <Sparkles size={11} />,
  sweep: <Layers size={11} />,
  fork: <Copy size={11} />,
  punch: <Scissors size={11} />,
  relyrics: <Repeat size={11} />,
  rerender: <PencilRuler size={11} />,
}

// depth-first lineage order: roots newest first, children chronological
function treeOrder(versions: VersionOut[]): { v: VersionOut; depth: number }[] {
  const byId = new Map(versions.map((v) => [v.id, v]))
  const children = new Map<string | null, VersionOut[]>()
  for (const v of versions) {
    const key = v.parent_version_id && byId.has(v.parent_version_id) ? v.parent_version_id : null
    children.set(key, [...(children.get(key) ?? []), v])
  }
  for (const [key, list] of children) {
    list.sort((x, y) => (key === null ? y.v - x.v : x.v - y.v))
  }
  const out: { v: VersionOut; depth: number }[] = []
  const walk = (key: string | null, depth: number) => {
    for (const v of children.get(key) ?? []) {
      out.push({ v, depth })
      walk(v.id, depth + 1)
    }
  }
  walk(null, 0)
  const seen = new Set(out.map((o) => o.v.id))
  for (const v of [...versions].sort((a, b) => a.v - b.v)) {
    if (!seen.has(v.id)) out.push({ v, depth: 1 }) // orphaned lineage
  }
  return out
}

function VersionList({
  project,
  selected,
  onSelect,
}: {
  project: ProjectDetail
  selected: VersionOut | null
  onSelect: (v: VersionOut) => void
}) {
  const t = useT()
  const ordered = treeOrder(project.versions)
  return (
    <Card>
      <CardHeader title={t('版本', 'Versions')} desc={`${project.versions.length} ${t('个 · 按谱系排列,点击载入工作区', '· by lineage; click to load the workspace')}`} />
      <CardBody className="space-y-1 p-2">
        {ordered.length === 0 && <div className="p-3 text-xs text-zinc-500">{t('暂无版本', 'No versions yet')}</div>}
        {ordered.map(({ v, depth }) => (
          <button
            key={v.id}
            onClick={() => onSelect(v)}
            style={{ paddingLeft: 8 + depth * 18 }}
            className={`flex w-full items-center justify-between rounded-lg py-2 pr-3 text-left text-sm transition-colors ${
              selected?.id === v.id ? 'bg-emerald-500/10 text-emerald-300' : 'text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              {depth > 0 && <span className="shrink-0 text-[10px] text-zinc-600">└</span>}
              <span className="shrink-0 text-zinc-600">{SOURCE_ICON[v.source] ?? null}</span>
              <span className="shrink-0 font-mono text-xs">v{v.v}</span>
              <span className="min-w-0 truncate text-xs text-zinc-500">{v.note || v.source}</span>
            </span>
            <span className="ml-2 flex shrink-0 items-center gap-2">
              {v.duration ? <span className="text-[11px] text-zinc-500">{Math.round(v.duration)}s</span> : null}
              <Badge status={v.status} />
            </span>
          </button>
        ))}
      </CardBody>
    </Card>
  )
}

function Workspace({
  project,
  version,
  onRefresh,
  onSelect,
}: {
  project: ProjectDetail
  version: VersionOut | null
  onRefresh: () => void
  onSelect: (v: VersionOut | null) => void
}) {
  const t = useT()
  const [region, setRegion] = useState<[number, number] | null>(null)
  const [duration, setDuration] = useState(0)
  const [auditioning, setAuditioning] = useState(false)
  const [loopRegion, setLoopRegion] = useState(false)
  const [nCand, setNCand] = useState(3)
  const [punchJob, setPunchJob] = useState<string | null>(null)
  const [applyJob, setApplyJob] = useState<string | null>(null)
  const [rerenderJob, setRerenderJob] = useState<string | null>(null)
  const [showAbc, setShowAbc] = useState(false)
  const [abcDraft, setAbcDraft] = useState('')
  const [abMode, setAbMode] = useState(false)
  const [abA, setAbA] = useState<string | null>(null)
  const [abB, setAbB] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const waveRef = useRef<WaveRegionsHandle | null>(null)
  const rafRef = useRef<number | null>(null)
  const auditionTokenRef = useRef(0)

  const punchStream = useJobStream(punchJob)
  const applyStream = useJobStream(applyJob)
  const rerenderStream = useJobStream(rerenderJob)
  const [agentJob, setAgentJob] = useState<string | null>(null)
  const [agentInstruction, setAgentInstruction] = useState('')
  const [showAgent, setShowAgent] = useState(false)
  const [showRelLyrics, setShowRelLyrics] = useState(false)
  const [relLyrics, setRelLyrics] = useState('')
  const agentStream = useJobStream(agentJob)
  const [duelJob, setDuelJob] = useState<string | null>(null)
  const duelStream = useJobStream(duelJob)
  const [libJob, setLibJob] = useState<string | null>(null)
  const libStream = useJobStream(libJob)
  const [detail, setDetail] = useState<VersionDetail | null>(null)
  const [showStems, setShowStems] = useState(false)
  const [stems, setStems] = useState<Record<string, string> | null>(null)
  const [stemJob, setStemJob] = useState<string | null>(null)
  const stemStream = useJobStream(stemJob)
  const [showTrans, setShowTrans] = useState(false)
  const [trans, setTrans] = useState<TransInfo | null>(null)
  const [transJob, setTransJob] = useState<string | null>(null)
  const transStream = useJobStream(transJob)
  const [lyricJob, setLyricJob] = useState<string | null>(null)
  const lyricStream = useJobStream(lyricJob)
  const [lrcText, setLrcText] = useState<string | null>(null)
  const [showLrc, setShowLrc] = useState(false)
  const [coverBusy, setCoverBusy] = useState(false)

  function genCover() {
    if (!version || coverBusy) return
    setCoverBusy(true)
    api<{ url: string }>(`/versions/${version.id}/cover`, { method: 'POST', body: JSON.stringify({ seed: 0 }) })
      .then((r) => {
        onRefresh()
        window.open(r.url, '_blank')
      })
      .catch((e) => alert(String(e)))
      .finally(() => setCoverBusy(false))
  }
  const [agentHist, setAgentHist] = useState<AgentHistItem[]>([])
  const [savedDraft, setSavedDraft] = useState(false)
  const stemJobRef = useRef(false)

  const punchResult = punchStream.result as PunchResult | undefined
  const rerenderResult = rerenderStream.result as GenResult | undefined
  const agentResult = agentStream.result as AgentEditResult | undefined
  const duelResult = duelStream.result as EvalResult | undefined
  const applyResult = applyStream.result as GenResult | undefined

  // version id we are waiting to appear and finish rendering, then auto-select
  const [pendingSelect, setPendingSelect] = useState<string | null>(null)

  useEffect(() => {
    if (applyStream.done && applyResult) {
      setPendingSelect(applyResult.version_id)
      setApplyJob(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyStream.done])

  useEffect(() => {
    if (rerenderStream.done && rerenderResult) {
      setPendingSelect(rerenderResult.version_id)
      setRerenderJob(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rerenderStream.done])

  useEffect(() => {
    if (!pendingSelect) return
    onRefresh()
    let alive = true
    const t = setInterval(() => {
      api<ProjectDetail>(`/projects/${project.id}`)
        .then((p) => {
          if (!alive) return
          const v = p.versions.find((x) => x.id === pendingSelect)
          if (v && (v.status === 'done' || v.status === 'failed' || v.status === 'cancelled')) {
            setPendingSelect(null)
            if (v.status === 'done') onSelect(v)
          }
        })
        .catch(() => {})
    }, 1500)
    return () => {
      alive = false
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSelect])

  useEffect(() => {
    if (stemStream.done && stemStream.job?.result && version) {
      setStemJob(null)
      stemJobRef.current = false
      api<{ stems: Record<string, string> }>(`/versions/${version.id}/stems`).then((r) => {
        setStems(r.stems)
        setShowStems(true)
      }).catch(() => {})
      onRefresh()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stemStream.done])

  useEffect(() => {
    if (transStream.done && transStream.job?.result && version) {
      setTransJob(null)
      api<TransInfo>(`/versions/${version.id}/transcription`).then((r) => {
        setTrans(r)
        setShowTrans(true)
      }).catch(() => {})
      onRefresh()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transStream.done])

  useEffect(() => {
    if (lyricStream.done && lyricStream.job?.result && version) {
      const res = lyricStream.job.result as { saved?: boolean; note?: string }
      setLyricJob(null)
      if (res.saved) {
        onRefresh()
        fetch(version.urls!.audio.replace(/song\.flac$/, 'lyrics.lrc'))
          .then((r) => r.text())
          .then((t) => {
            setLrcText(t)
            setShowLrc(true)
          })
          .catch(() => {})
      } else {
        alert(res.note ?? t('歌词对齐不可用', 'Lyric alignment unavailable'))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyricStream.done])

  function loadLrc() {
    if (!version) return
    const lrcUrl = version.urls?.lrc
    if (lrcUrl) {
      if (showLrc) {
        setShowLrc(false)
        return
      }
      fetch(lrcUrl)
        .then((r) => r.text())
        .then((t) => {
          setLrcText(t)
          setShowLrc(true)
        })
        .catch((e) => alert(String(e)))
      return
    }
    api<{ job_id: string }>('/lyrics', { method: 'POST', body: JSON.stringify({ version_id: version.id }) })
      .then((r) => setLyricJob(r.job_id))
      .catch((e) => alert(String(e)))
  }

  useEffect(() => {
    if (showAgent) {
      if (version) api<AgentHistItem[]>(`/agent/history?version_id=${version.id}`).then(setAgentHist).catch(() => {})
    } else {
      setAgentHist([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAgent, version?.id])

  useEffect(() => {
    setRegion(null)
    setShowAbc(false)
    setShowRelLyrics(false)
    setAbcDraft(version?.abc ?? '')
    // drop per-version job state so nothing leaks across versions
    setPunchJob(null)
    setApplyJob(null)
    setRerenderJob(null)
    setAgentJob(null)
    setDuelJob(null)
    setLibJob(null)
    setStemJob(null)
    setTransJob(null)
    setStems(null)
    setShowStems(false)
    setTrans(null)
    setShowTrans(false)
    setLyricJob(null)
    setLrcText(null)
    setShowLrc(false)
    setSavedDraft(false)
    stemJobRef.current = false
    stopAudition()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version?.id])

  // per-version capability flags (has_stems / has_cover / abc_draft …)
  useEffect(() => {
    setDetail(null)
    if (version) {
      api<VersionDetail>(`/versions/${version.id}`).then(setDetail).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version?.id])

  // stop any audition playback when leaving the page
  useEffect(
    () => () => {
      stopAudition()
      audioRef.current = null
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  function stopAudition() {
    auditionTokenRef.current++
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    audioRef.current?.pause()
    setAuditioning(false)
  }

  async function audition() {
    if (!region || !version) return
    // button doubles as stop while a preview is playing
    if (auditioning) {
      stopAudition()
      return
    }
    setAuditioning(true)
    const token = ++auditionTokenRef.current
    waveRef.current?.pause()
    try {
      const res = await api<{ url: string }>(`/audition`, {
        method: 'POST',
        body: JSON.stringify({ version_id: version.id, region }),
      })
      if (token !== auditionTokenRef.current) return // stopped while decoding
      if (!audioRef.current) audioRef.current = new Audio()
      const audio = audioRef.current
      audio.onended = () => {
        if (auditionTokenRef.current === token) setAuditioning(false)
      }
      audio.loop = loopRegion // loop mode: 'ended' never fires, button stops it
      audio.src = res.url
      await audio.play()
      if (token !== auditionTokenRef.current) {
        audio.pause()
        return
      }
      // the slice audio starts at region[0]: drive the waveform cursor from it
      const t0 = region[0]
      waveRef.current?.setTime(t0)
      const tick = () => {
        if (auditionTokenRef.current !== token) return
        if (!audio.paused && !audio.ended) {
          waveRef.current?.setTime(t0 + audio.currentTime)
          rafRef.current = requestAnimationFrame(tick)
        } else {
          rafRef.current = null
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch (e) {
      if (token === auditionTokenRef.current) {
        setAuditioning(false)
        alert(String(e))
      }
    }
  }

  if (!version || version.status !== 'done' || !version.urls) {
    return (
      <Card>
        <CardBody className="text-sm text-zinc-500">
          {version ? `${t('版本', 'Version')} v${version.v} · ${version.status}` : t('从左侧选择一个版本进入工作区', 'Pick a version on the left to enter the workspace')}
        </CardBody>
      </Card>
    )
  }

  const cfg = (version.config ?? {}) as Record<string, unknown>

  const lrcLines = (lrcText ?? '')
    .split('\n')
    .map((line) => {
      const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/)
      return m ? { t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() } : null
    })
    .filter((x): x is { t: number; text: string } => x !== null)

  function startPunch(n: number) {
    if (!region || !version) return
    api<{ job_id: string }>('/generate/punch', {
      method: 'POST',
      body: JSON.stringify({ version_id: version.id, region, candidates: n }),
    })
      .then((r) => setPunchJob(r.job_id))
      .catch((e) => alert(String(e)))
  }

  function tailSing() {
    if (!version) return
    const start = region?.[0] ?? duration * 0.5
    const end = duration
    setRegion([start, end])
    api<{ job_id: string }>('/generate/punch', {
      method: 'POST',
      body: JSON.stringify({ version_id: version.id, region: [start, end], candidates: 2 }),
    })
      .then((r) => setPunchJob(r.job_id))
      .catch((e) => alert(String(e)))
  }

  function startRelLyrics() {
    if (!version) return
    api<{ job_id: string }>('/generate', {
      method: 'POST',
      body: JSON.stringify({
        project_id: project.id,
        style: String(cfg.style ?? ''),
        lyrics: relLyrics,
        cot: (cfg.cot as 'full' | 'melody' | 'off') ?? 'full',
        seed: (cfg.seed as number) ?? null,
        abc: version.abc,
        source: 'relyrics',
        note: t('改词重唱', 'new-lyrics re-sing'),
      }),
    })
      .then((r) => setRerenderJob(r.job_id))
      .catch((e) => alert(String(e)))
  }

  function adopt(idx: number) {
    if (!punchResult || !version) return
    api<{ job_id: string }>('/punch/apply', {
      method: 'POST',
      body: JSON.stringify({ version_id: version.id, punch_id: punchResult.punch_id, idx }),
    })
      .then((r) => setApplyJob(r.job_id))
      .catch((e) => alert(String(e)))
  }

  function rerenderFull() {
    if (!version) return
    api<{ job_id: string }>('/generate', {
      method: 'POST',
      body: JSON.stringify({
        project_id: project.id,
        style: String(cfg.style ?? ''),
        lyrics: String(cfg.lyrics ?? ''),
        cot: (cfg.cot as 'full' | 'melody' | 'off') ?? 'full',
        seed: (cfg.seed as number) ?? null,
        abc: abcDraft,
        source: 'rerender',
        note: t('改谱重渲染', 'score re-render'),
      }),
    })
      .then((r) => setRerenderJob(r.job_id))
      .catch((e) => alert(String(e)))
  }

  function addToLibrary() {
    if (!version) return
    api<{ job_id: string }>('/library/import-version', {
      method: 'POST',
      body: JSON.stringify({ version_id: version.id }),
    })
      .then((r) => setLibJob(r.job_id))
      .catch((e) => alert(String(e)))
  }

  function forkVersion() {
    if (!version) return
    if (!window.confirm(t(`复制 v${version.v} 为新版本?`, `Fork v${version.v} as a new version?`))) return
    api<{ version_id: string }>(`/versions/${version.id}/fork`, {
      method: 'POST',
      body: JSON.stringify({ note: `${t('自', 'from')} v${version.v}` }),
    })
      .then((r) => {
        // wait for this exact version instead of guessing by source
        setPendingSelect(r.version_id)
        onRefresh()
      })
      .catch((e) => alert(String(e)))
  }

  function deleteVersion() {
    if (!version) return
    if (!window.confirm(t(`删除 v${version.v}?音频与全部工件将一并删除,不可恢复。`, `Delete v${version.v}? Audio and all artifacts go with it. No undo.`))) return
    api(`/versions/${version.id}`, { method: 'DELETE' })
      .then(() => {
        onSelect(null)
        onRefresh()
      })
      .catch((e) => alert(String(e)))
  }

  function saveDraft() {
    if (!version || !abcDraft.trim()) return
    api(`/versions/${version.id}/abc`, {
      method: 'PUT',
      body: JSON.stringify({ abc: abcDraft, note: t('工作区草稿', 'workspace draft') }),
    })
      .then(() => {
        setSavedDraft(true)
        api<VersionDetail>(`/versions/${version.id}`).then(setDetail).catch(() => {})
      })
      .catch((e) => alert(String(e)))
  }

  function loadStems() {
    if (!version) return
    if (detail?.has_stems) {
      if (stems) { setShowStems(false); return }
      api<{ stems: Record<string, string> }>(`/versions/${version.id}/stems`).then((r) => {
        setStems(r.stems)
        setShowStems(true)
      }).catch((e) => alert(String(e)))
      return
    }
    if (stemJobRef.current) return
    stemJobRef.current = true
    api<{ job_id: string }>('/stems', { method: 'POST', body: JSON.stringify({ version_id: version.id }) })
      .then((r) => setStemJob(r.job_id))
      .catch((e) => { alert(String(e)); stemJobRef.current = false })
  }

  function loadTranscription() {
    if (!version) return
    if (detail?.has_transcription) {
      if (trans && showTrans) { setShowTrans(false); return }
      api<TransInfo>(`/versions/${version.id}/transcription`).then((r) => {
        setTrans(r)
        setShowTrans(true)
      }).catch((e) => alert(String(e)))
      return
    }
    if (!window.confirm(t('该版本还没扒过谱,现在跑一次 SheetSage2 转录?(约 30~60s)', 'This version has no transcription yet — run SheetSage2 now? (~30–60s)'))) return
    api<{ job_id: string }>('/transcribe', { method: 'POST', body: JSON.stringify({ version_id: version.id }) })
      .then((r) => setTransJob(r.job_id))
      .catch((e) => alert(String(e)))
  }

  function runAgent() {
    if (!version || !agentInstruction.trim()) return
    api<{ job_id: string }>('/agent/edit', {
      method: 'POST',
      body: JSON.stringify({ version_id: version.id, instruction: agentInstruction.trim() }),
    })
      .then((r) => setAgentJob(r.job_id))
      .catch((e) => alert(String(e)))
  }

  function adoptProposal() {
    if (!agentResult) return
    setAbcDraft(agentResult.proposed_abc)
    setShowAbc(true)
    setAgentJob(null)
  }

  function runDuel() {
    if (!abA || !abB) return
    api<{ job_id: string }>('/evaluate', {
      method: 'POST',
      body: JSON.stringify({ version_ids: [abA, abB], labels: ['A', 'B'] }),
    })
      .then((r) => setDuelJob(r.job_id))
      .catch((e) => alert(String(e)))
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title={`${t('工作区', 'Workspace')} · v${version.v}`}
          desc={`${Math.round(version.duration ?? 0)}s · ${version.note || version.source}`}
          right={
            <button className="text-xs text-zinc-400 hover:text-emerald-400" onClick={() => setAbMode((s) => !s)}>
              {abMode ? t('退出 A/B', 'Exit A/B') : t('A/B 对比', 'A/B compare')}
            </button>
          }
        />
        <CardBody className="space-y-3">
          <WaveRegionsPlayer
            ref={waveRef}
            url={version.urls.audio}
            onRegionChange={(r) => {
              stopAudition()
              setRegion(r)
            }}
            onPlay={stopAudition}
            onDuration={setDuration}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <div className="flex items-center gap-1.5">
              <Input
                type="number" step={0.1} min={0} max={duration}
                aria-label={t('选区起点(秒)', 'Region start (s)')}
                value={region ? region[0] : ''}
                placeholder="0.0"
                className="h-8 w-20 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-center font-mono text-xs"
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isNaN(v)) return
                  const s = Math.max(0, v)
                  const e2 = region ? Math.max(region[1], s + 0.1) : Math.min(duration || s + 5, s + 5)
                  const next: [number, number] = [s, Math.round(Math.min(e2, duration || e2) * 10) / 10]
                  setRegion(next)
                  waveRef.current?.setRegion(next[0], next[1])
                }}
              />
              <span className="text-zinc-600">–</span>
              <Input
                type="number" step={0.1} min={0} max={duration}
                aria-label={t('选区终点(秒)', 'Region end (s)')}
                value={region ? region[1] : ''}
                placeholder={(duration || 15).toFixed(1)}
                className="h-8 w-20 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-center font-mono text-xs"
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isNaN(v)) return
                  const e2 = Math.max(0, v)
                  const s = region ? Math.min(region[0], Math.max(0, e2 - 0.1)) : 0
                  const next: [number, number] = [Math.round(s * 10) / 10, Math.round(Math.min(e2, duration || e2) * 10) / 10]
                  setRegion(next)
                  waveRef.current?.setRegion(next[0], next[1])
                }}
              />
              {region && (
                <span className="rounded-md bg-emerald-500/10 px-2 py-1 font-mono text-emerald-400">
                  {(region[1] - region[0]).toFixed(1)}s
                </span>
              )}
            </div>
            {!region && (
              <span>{t('在波形上拖选一段(≥1s),或直接输入起止时间', 'Drag-select on the waveform (≥1s), or type the times')}</span>
            )}
            <span className="flex-1" />
            <Button size="sm" variant="outline" disabled={!region} onClick={audition}>
              {auditioning ? <Square size={13} /> : <Play size={13} />} {auditioning ? t('停止试听', 'Stop audition') : t('试听选区', 'Audition region')}
            </Button>
            <Button
              size="sm"
              variant={loopRegion ? 'default' : 'outline'}
              className={loopRegion ? undefined : 'text-zinc-400'}
              title="开启后,试听选区到结尾自动从头循环;关闭则到结尾停止"
              onClick={() =>
                setLoopRegion((v) => {
                  const next = !v
                  if (audioRef.current) audioRef.current.loop = next
                  return next
                })
              }
            >
              <Repeat size={13} /> {t('循环选区', 'Loop')}
            </Button>
            <span className="flex items-center gap-1">
              <SelectMenu
                className="w-24"
                value={String(nCand)}
                onChange={(v) => setNCand(Number(v))}
                options={[2, 3, 4, 6].map((n) => ({ value: String(n), label: `${n} ${t('候选', 'candidates')}` }))}
              />
              <Button size="sm" disabled={!region || !!punchJob && !punchStream.done} onClick={() => startPunch(nCand)}>
                <Scissors size={13} /> {t('挖补选区', 'Punch')}
              </Button>
            </span>
            <Button size="sm" disabled={!!punchJob && !punchStream.done} onClick={tailSing}>
              <Repeat size={13} /> {t('尾段重唱', 'Re-sing tail')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setShowRelLyrics((s) => !s); setRelLyrics(String(cfg.lyrics ?? '')) }}>
              <Repeat size={13} /> {t('改词重唱', 'New lyrics')}
            </Button>
            <Button size="sm" variant="outline" onClick={loadTranscription}>
              {transJob && !transStream.done ? <Loader2 className="animate-spin" size={13} /> : <FileSearch size={13} />} {t('转录', 'Transcribe')}
            </Button>
            <Button size="sm" variant="outline" onClick={loadLrc} title={t('ASR 歌词对齐,生成带时间轴的 .lrc', 'ASR lyric alignment — generates a timed .lrc')}>
              {lyricJob && !lyricStream.done ? <Loader2 className="animate-spin" size={13} /> : <Mic2 size={13} />} LRC
            </Button>
            <Button size="sm" variant="outline" onClick={loadStems}>
              {stemJob && !stemStream.done ? <Loader2 className="animate-spin" size={13} /> : <AudioLines size={13} />} {t('分轨', 'Stems')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setShowAbc((s) => !s); setAbcDraft(detail?.abc_draft?.abc ?? version.abc ?? '') }}>
              <PencilRuler size={13} /> {t('ABC 编辑', 'ABC edit')}{detail?.abc_draft ? ' ·' : ''}
            </Button>
          </div>
        </CardBody>
      </Card>

      {punchJob && !punchStream.done && <JobPanel jobId={punchJob} events={punchStream.events} done={punchStream.done} title="挖补候选生成" />}

      {punchStream.done && punchResult && (
        <Card>
          <CardHeader
            title={t(`候选片段(${punchResult.seconds}s)`, `Candidates (${punchResult.seconds}s)`)}
            desc={t("同一乐谱内容的不同演绎,试听后采用", "Alternative takes of the same score — audition and adopt") + (punchResult.snapped ? t(" · 已对齐小节线", " · bar-aligned") : "")}
            right={<button className="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setPunchJob(null)}>{t('收起', 'Collapse')}</button>}
          />
          <CardBody className="space-y-2">
            {punchResult.candidates.map((c) => (
              <div key={c.idx} className="flex items-center gap-3 rounded-lg border border-zinc-800 p-2">
                <span className="w-14 shrink-0 font-mono text-xs text-zinc-400">#{c.idx + 1}</span>
                <span className="w-24 shrink-0 font-mono text-[11px] text-zinc-500">seed {c.seed}</span>
                <div className="min-w-0 flex-1"><AudioPlayer url={c.audition_url} height={36} /></div>
                <Button size="sm" disabled={!!applyJob && !applyStream.done} onClick={() => adopt(c.idx)}>
                  {applyJob && !applyStream.done ? <Loader2 className="animate-spin" size={13} /> : null} {t('采用拼回', 'Adopt & apply')}
                </Button>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {applyJob && !applyStream.done && <JobPanel jobId={applyJob} events={applyStream.events} done={applyStream.done} title={t('拼回新版本', 'Apply punch')} />}

      {showRelLyrics && (
        <Card>
          <CardHeader title={t('改词重唱', 'New-lyrics re-sing')} desc={t('同 seed + 同乐谱 + 新歌词:旋律内容不变,整曲重新演绎(prefix 全局条件,任何改动都会重塑整首演唱)', 'Same seed + score + new lyrics: melody unchanged, whole performance re-sung (prefix is a global condition — any change reshapes the whole take)')} />
          <CardBody className="space-y-3">
            <Textarea rows={9} value={relLyrics} onChange={(e) => setRelLyrics(e.target.value)} className="font-mono text-[13px]" />
            <Button disabled={!relLyrics.trim() || !!rerenderJob && !rerenderStream.done} onClick={startRelLyrics}>
              {rerenderJob && !rerenderStream.done ? <Loader2 className="animate-spin" size={14} /> : <Repeat size={14} />} {t('以原 seed 重唱', 'Re-sing with original seed')}
            </Button>
          </CardBody>
        </Card>
      )}

      {showStems && stems && (
        <Card>
          <CardHeader title={t('分轨试听', 'Stem audition')} desc={t('HTDemucs 四轨,可分别独听(重渲染仍为整曲行为)', 'HTDemucs four stems, solo each (re-rendering still works on the full mix)')} />
          <CardBody className="space-y-2">
            {[['vocals', t('人声', 'Vocals')], ['drums', t('鼓', 'Drums')], ['bass', t('贝斯', 'Bass')], ['other', t('其他', 'Other')]].map(([k, label]) =>
              stems[k] ? (
                <div key={k} className="flex items-center gap-3">
                  <span className="w-10 shrink-0 text-xs text-zinc-400">{label}</span>
                  <div className="min-w-0 flex-1"><AudioPlayer url={stems[k]} height={40} /></div>
                </div>
              ) : null,
            )}
          </CardBody>
        </Card>
      )}

      {showTrans && trans && (
        <Card>
          <CardHeader
            title={t('版本转录', 'Version transcription')}
            desc={[trans.summary.keys?.[0]?.key && `${t('调性', 'Key')} ${trans.summary.keys[0].key}`, trans.summary.tempo && `${trans.summary.tempo} BPM`, `${trans.n_beats} ${t('拍', 'beats')} / ${trans.n_downbeats} ${t('强拍', 'downbeats')}`].filter(Boolean).join(' · ')}
          />
          <CardBody className="space-y-3">
            <Notation abc={trans.abc} height={240} />
            <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
              {Object.entries(trans.files).map(([name, url]) => (
                <a key={name} href={url} download className="hover:text-emerald-400">{name}</a>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {transJob && !transStream.done && <JobPanel jobId={transJob} events={transStream.events} done={transStream.done} title={t('扒谱中', 'Transcribing')} />}
      {stemJob && !stemStream.done && <JobPanel jobId={stemJob} events={stemStream.events} done={stemStream.done} title={t('分离分轨', 'Separating stems')} />}
      {lyricJob && !lyricStream.done && <JobPanel jobId={lyricJob} events={lyricStream.events} done={lyricStream.done} title={t('歌词对齐', 'Lyric alignment')} />}

      {showLrc && lrcText && (
        <Card>
          <CardHeader
            title={t('LRC 歌词', 'LRC lyrics')}
            desc={`${lrcLines.length} ${t('行', 'lines')} · ${t('时间轴来自 ASR 对齐,按停顿分行', 'timings from ASR alignment, split on pauses')}`}
            right={<button className="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setShowLrc(false)}>{t('收起', 'Collapse')}</button>}
          />
          <CardBody className="max-h-72 space-y-0.5 overflow-auto">
            {lrcLines.map((l, i) => (
              <div key={i} className="flex gap-3 text-xs">
                <span className="w-14 shrink-0 font-mono text-zinc-600">
                  {`${String(Math.floor(l.t / 60)).padStart(2, '0')}:${(l.t % 60).toFixed(2).padStart(5, '0')}`}
                </span>
                <span className="text-zinc-200">{l.text}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {showAbc && (
        <Card className="scroll-mt-16" id="abc-editor">
          <CardHeader
            title={t('ABC 乐谱编辑', 'ABC score editor')}
            desc={
              detail?.abc_draft
                ? t(`已载入未渲染草稿(${new Date(detail.abc_draft.updated_at * 1000).toLocaleString()}保存)`, `Unrendered draft loaded (saved ${new Date(detail.abc_draft.updated_at * 1000).toLocaleString()})`)
                : t("改谱后整曲重渲染:新谱严格约束旋律与和弦,演绎为全新一版(挖补才是局部替换)", "Re-render the whole song from the edited score: the new score strictly constrains melody & chords into a fresh take (punching is the local variant)")
            }
          />
          <CardBody className="space-y-3">
            <Textarea rows={12} value={abcDraft} onChange={(e) => setAbcDraft(e.target.value)} className="font-mono text-[12px]" />
            <Notation abc={abcDraft} height={260} />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={!abcDraft.trim() || abcDraft === version.abc && !detail?.abc_draft} onClick={saveDraft} title={t('把当前编辑保存为草稿,刷新不丢', "Save the current edit as a draft — survives reloads")}>
                {savedDraft ? t('草稿已保存', 'Draft saved') : t('保存草稿', 'Save draft')}
              </Button>
              <Button disabled={!!rerenderJob && !rerenderStream.done || !abcDraft.trim()} onClick={rerenderFull}>
                {rerenderJob && !rerenderStream.done ? <Loader2 className="animate-spin" size={14} /> : null} {t('重渲染整曲', 'Re-render song')}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {rerenderJob && !rerenderStream.done && <JobPanel jobId={rerenderJob} events={rerenderStream.events} done={rerenderStream.done} title={t('改谱重渲染', 'Score re-render')} />}

      {abMode && (
        <Card>
          <CardHeader title={t('A / B 对比', 'A / B compare')} desc={t('选两个版本上下对听', "Pick two versions and compare them back to back")} />
          <CardBody className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {[['A', abA, setAbA] as const, ['B', abB, setAbB] as const].map(([label, val, set]) => (
                <div key={label}>
                  <SelectMenu
                    value={val ?? ''}
                    onChange={(v) => set(v || null)}
                    options={[
                      { value: '', label: `${t('选择版本', 'Pick version')} ${label}` },
                      ...project.versions.filter((v) => v.status === 'done' && v.urls).map((v) => ({ value: v.id, label: `v${v.v} · ${v.note || v.source}` })),
                    ]}
                  />
                </div>
              ))}
            </div>
            {project.versions.filter((v) => v.id && (v.id === abA || v.id === abB) && v.urls).map((v) => (
              <div key={v.id} className="rounded-lg border border-zinc-800 p-3">
                <div className="mb-2 text-xs text-zinc-400">{v.id === abA ? 'A' : 'B'} · v{v.v} {v.note}</div>
                <AudioPlayer url={v.urls!.audio} height={48} />
              </div>
            ))}
            {abA && abB && (
              <div className="space-y-2">
                <Button size="sm" variant="outline" disabled={!!duelJob && !duelStream.done} onClick={runDuel}>
                  {duelJob && !duelStream.done ? <Loader2 className="animate-spin" size={13} /> : <Gauge size={13} />} {t('自动评测对比', 'Auto-evaluate & compare')}
                </Button>
                {duelJob && !duelStream.done && <JobPanel jobId={duelJob} events={duelStream.events} done={duelStream.done} title={t('评测', 'Evaluation')} />}
                {duelStream.done && duelResult?.duel && (
                  <div className="overflow-hidden rounded-lg border border-zinc-800">
                    <table className="w-full text-xs">
                      <thead className="bg-zinc-900 text-zinc-400">
                        <tr><th className="px-2 py-1.5 text-left">{t('指标', 'Metric')}</th><th className="px-2 py-1.5">A</th><th className="px-2 py-1.5">B</th><th className="px-2 py-1.5">{t('占优', 'Favors')}</th></tr>
                      </thead>
                      <tbody>
                        {duelResult.duel.rows.map((r, i) => (
                          <tr key={i} className="border-t border-zinc-800">
                            <td className="px-2 py-1.5 text-zinc-300">{r.metric}</td>
                            <td className="px-2 py-1.5 text-center font-mono text-zinc-400">{String(r.a ?? '—')}</td>
                            <td className="px-2 py-1.5 text-center font-mono text-zinc-400">{String(r.b ?? '—')}</td>
                            <td className={`px-2 py-1.5 text-center ${r.winner === 'tie' ? 'text-zinc-500' : 'text-emerald-400'}`}>{r.winner ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="border-t border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-[11px] text-zinc-400">
                      {t('自动倾向:', 'Auto leans toward:')}<span className="text-emerald-400">{duelResult.duel.auto_suggestion}</span>({t('最终以人耳对听为准', 'ears have the final say')})
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Bot size={15} /> {t('AI 改谱', 'AI score edit')}</span>}
          desc={t('自然语言指令 → 工具化改谱(移调/爵士和声/变速)→ diff 人审 → 重渲染', 'Natural-language instruction → tool-based score edit (transpose / jazz harmony / tempo) → human-reviewed diff → re-render')}
          right={<button className="text-xs text-zinc-400 hover:text-emerald-400" onClick={() => setShowAgent((s) => !s)}>{showAgent ? t('收起', 'Collapse') : t('展开', 'Expand')}</button>}
        />
        {showAgent && (
          <CardBody className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={agentInstruction}
                placeholder={t('例:整体升高一个全音,和弦加爵士七和弦,速度 110', 'e.g. up a whole tone, add jazz sevenths, tempo 110')}
                onChange={(e) => setAgentInstruction(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runAgent()}
              />
              <Button disabled={!agentInstruction.trim() || !!agentJob && !agentStream.done} onClick={runAgent}>
                {agentJob && !agentStream.done ? <Loader2 className="animate-spin" size={14} /> : <Bot size={14} />} {t('执行', 'Run')}
              </Button>
            </div>
            {agentJob && !agentStream.done && <JobPanel jobId={agentJob} events={agentStream.events} done={agentStream.done} title={t('改谱规划', 'Score edit planning')} />}
            {agentStream.done && agentResult && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {agentResult.steps.map((s, i) => (
                    <span key={i} className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-400">
                      {s.tool} {JSON.stringify(s.args)}
                    </span>
                  ))}
                  <span className="text-zinc-500">
                    {JSON.stringify(agentResult.info_before.key)} → {JSON.stringify(agentResult.info_after.key)}
                  </span>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <Notation abc={agentResult.original_abc} height={200} />
                  <Notation abc={agentResult.proposed_abc} height={200} />
                </div>
                <details className="text-xs text-zinc-500">
                  <summary className="cursor-pointer select-none">diff</summary>
                  <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-zinc-950 p-2 font-mono text-[11px]">{agentResult.diff}</pre>
                </details>
                <Button size="sm" onClick={adoptProposal}>{t('采纳到编辑器(可再手改后重渲染)', 'Adopt into editor (edit further, then re-render)')}</Button>
              </div>
            )}
            {showAgent && agentHist.length > 0 && (
              <details className="text-xs text-zinc-500">
                <summary className="cursor-pointer select-none">{t('历史指令', 'Instruction history')} ({agentHist.length})</summary>
                <div className="mt-2 space-y-1">
                  {agentHist.map((h, i) => (
                    <div key={i} className="rounded-lg bg-zinc-950 px-2 py-1.5">
                      <span className="text-zinc-400">{new Date(h.t * 1000).toLocaleString()}</span>
                      <span className="ml-2 text-zinc-200">{h.instruction}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </CardBody>
        )}
      </Card>

      {libJob && !libStream.done && <JobPanel jobId={libJob} events={libStream.events} done={libStream.done} title={t('加入音乐库', 'Add to library')} />}
      {libStream.done && libStream.job?.result && (
        <Card>
          <CardBody className="flex items-center justify-between text-xs text-zinc-400">
            <span>{t('已入库:', 'Added to library:')}<span className="text-zinc-200">{String((libStream.job.result as Record<string, unknown>).title ?? '')}</span></span>
            <Link to="/library" className="text-emerald-400 hover:underline">{t('去音乐库查看 →', 'Open library →')}</Link>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={t('工件', 'Artifacts')} />
        <CardBody className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
          <a href={version.urls.audio} download className="hover:text-emerald-400">FLAC</a>
          <a href={`/api/versions/${version.id}/export/mp3`} download className="hover:text-emerald-400" title={t('MP3 转码(192k)', 'MP3 transcode (192k)')}>MP3</a>
          {detail?.has_stems ? (
            <a href={`/api/versions/${version.id}/export/stems.zip`} download className="hover:text-emerald-400">{t('分轨 ZIP', 'Stems ZIP')}</a>
          ) : (
            <span className="text-zinc-600" title={t('先跑一次分轨', 'Run stem separation first')}>{t('分轨 ZIP', 'Stems ZIP')}</span>
          )}
          <a href={`/api/versions/${version.id}/export/daw`} download className="hover:text-emerald-400" title={t('整曲 + ABC + 转录 MIDI + 分轨打包', 'Song + ABC + transcription MIDI + stems bundle')}>{t('DAW 包', 'DAW bundle')}</a>
          <a href={`/api/versions/${version.id}/export/score.pdf`} target="_blank" rel="noreferrer" className="hover:text-emerald-400" title={t('服务端渲染乐谱 PDF', 'Server-rendered score PDF')}>{t('乐谱 PDF', 'Score PDF')}</a>
          {version.urls?.lrc && <a href={version.urls.lrc} download className="hover:text-emerald-400">{t('LRC', 'LRC')}</a>}
          {detail?.has_stems && (
            <a href={`/api/versions/${version.id}/export/instrumental`} download className="hover:text-emerald-400" title={t('去人声伴奏(鼓+贝斯+其他混音)', 'Karaoke backing (drums + bass + other mix)')}>{t('伴奏', 'Backing')}</a>
          )}
          {detail?.has_cover && version.urls?.cover ? (
            <a href={`${version.urls.cover}?t=${detail.abc_draft?.updated_at ?? ''}`} target="_blank" rel="noreferrer" className="hover:text-emerald-400">{t('封面', 'Cover')}</a>
          ) : (
            <button className="hover:text-emerald-400" title={t('生成程序化封面(渐变 + 真实波形)', 'Generate procedural cover (gradient + real waveform)')} onClick={genCover}>{coverBusy ? t('生成中…', 'Generating…') : '封面'}</button>
          )}
          <a href={`/api/versions/${version.id}/export/release`} download className="font-medium text-emerald-400/90 hover:text-emerald-300" title={t('发布包:整曲 FLAC+MP3 + 封面 + 歌词/LRC + ABC', 'Release: song FLAC+MP3 + cover + lyrics/LRC + ABC')}>{t('发布包', 'Release bundle')}</a>
          <button
            className="hover:text-emerald-400"
            onClick={() => {
              setShowAbc(true)
              setAbcDraft(version.abc ?? '')
              setTimeout(() => document.getElementById('abc-editor')?.scrollIntoView({ behavior: 'smooth' }), 80)
            }}
          >
            {t('ABC 查看/编辑', 'ABC view / edit')}
          </button>
          <a href={version.urls.latents} download className="hover:text-emerald-400">{t('隐变量', 'Latents')}</a>
          <a href={version.urls.semantic} download className="hover:text-emerald-400">{t('语义 token', 'Semantic tokens')}</a>
          {cfg.abc_provided ? <span className="text-emerald-400/70">{t('外部乐谱驱动', 'externally scored')}</span> : null}
          <span className="flex-1" />
          <Link to={`/master?v=${version.id}`} title={t('母带处理(预览 A/B + 导出)', 'Mastering (A/B preview + export)')}>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0"><Disc3 size={14} /></Button>
          </Link>
          <Button size="sm" variant="ghost" title={t('复制为新版本', 'Fork as new version')} className="h-8 w-8 p-0" onClick={forkVersion}><Copy size={14} /></Button>
          <Button size="sm" variant="ghost" title={t('删除此版本', 'Delete this version')} className="h-8 w-8 p-0 text-zinc-500 hover:text-red-400" onClick={deleteVersion}><Trash2 size={14} /></Button>
          <Button size="sm" variant="outline" disabled={!!libJob && !libStream.done} onClick={addToLibrary} title={t('把当前版本加入音乐库(自动分析打标)', 'Add this version to the library (auto-tagged)')}>
            {libJob && !libStream.done ? <Loader2 className="animate-spin" size={13} /> : <LibraryBig size={13} />} {t('加入音乐库', 'Add to library')}
          </Button>
        </CardBody>
      </Card>
    </div>
  )
}
