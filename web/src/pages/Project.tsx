import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Bot, ChevronLeft, Gauge, Loader2, Play, Scissors, Repeat, PencilRuler } from 'lucide-react'
import { api, type ProjectDetail, type VersionOut } from '@/lib/api'
import { useJobStream } from '@/lib/job'
import { JobPanel } from '@/components/JobPanel'
import { Notation } from '@/components/Notation'
import { AudioPlayer } from '@/components/AudioPlayer'
import { WaveRegionsPlayer } from '@/components/WaveRegionsPlayer'
import { Badge, Button, Card, CardBody, CardHeader, Input, Textarea } from '@/components/ui'
import { SelectMenu } from '@/components/SelectMenu'

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
type EvalResult = {
  evals: Record<string, Record<string, unknown>>
  duel: { rows: { metric: string; a: unknown; b: unknown; winner: string | null }[]; auto_suggestion: string } | null
}

export function ProjectPage() {
  const { id } = useParams()
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [selected, setSelected] = useState<VersionOut | null>(null)

  const load = useCallback(() => {
    if (!id) return
    api<ProjectDetail>(`/projects/${id}`).then((p) => {
      setProject(p)
      setSelected((cur) => {
        if (cur) return p.versions.find((v) => v.id === cur.id) ?? null
        return p.versions.find((v) => v.status === 'done') ?? null
      })
    })
  }, [id])

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  if (!project) return <div className="p-8 text-sm text-zinc-500">加载中…</div>

  return (
    <div className="mx-auto max-w-6xl p-5">
      <div className="mb-4 flex items-center gap-3">
        <Link to="/projects" className="text-zinc-500 hover:text-zinc-200"><ChevronLeft size={18} /></Link>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{project.title}</h1>
          <div className="truncate text-xs text-zinc-500">{project.style}</div>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        <VersionList project={project} selected={selected} onSelect={setSelected} />
        <Workspace project={project} version={selected} onRefresh={load} onSelect={setSelected} />
      </div>
    </div>
  )
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
  return (
    <Card>
      <CardHeader title="版本" desc={`${project.versions.length} 个 · 点击载入工作区`} />
      <CardBody className="space-y-1 p-2">
        {project.versions.length === 0 && <div className="p-3 text-xs text-zinc-500">暂无版本</div>}
        {project.versions.map((v) => (
          <button
            key={v.id}
            onClick={() => onSelect(v)}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              selected?.id === v.id ? 'bg-emerald-500/10 text-emerald-300' : 'text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
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
  onSelect: (v: VersionOut) => void
}) {
  const [region, setRegion] = useState<[number, number] | null>(null)
  const [duration, setDuration] = useState(0)
  const [auditioning, setAuditioning] = useState(false)
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

  const punchResult = useMemo(
    () => (punchStream.job?.result ?? punchStream.events.find((e) => e.result)?.result) as PunchResult | undefined,
    [punchStream],
  )
  const rerenderResult = useMemo(
    () => (rerenderStream.job?.result ?? rerenderStream.events.find((e) => e.result)?.result) as GenResult | undefined,
    [rerenderStream],
  )
  const agentResult = useMemo(
    () => (agentStream.job?.result ?? agentStream.events.find((e) => e.result)?.result) as AgentEditResult | undefined,
    [agentStream],
  )
  const duelResult = useMemo(
    () => (duelStream.job?.result ?? duelStream.events.find((e) => e.result)?.result) as EvalResult | undefined,
    [duelStream],
  )
  const applyResult = useMemo(
    () => (applyStream.job?.result ?? applyStream.events.find((e) => e.result)?.result) as GenResult | undefined,
    [applyStream],
  )

  useEffect(() => {
    if (applyStream.done && applyResult) {
      onRefresh()
      const t = setInterval(() => {
        api<ProjectDetail>(`/projects/${project.id}`).then((p) => {
          const v = p.versions.find((x) => x.id === applyResult.version_id)
          if (v && v.status === 'done') {
            onSelect(v)
            clearInterval(t)
          }
        })
      }, 1500)
      setApplyJob(null)
      return () => clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyStream.done])

  useEffect(() => {
    if (rerenderStream.done && rerenderResult) {
      onRefresh()
      const t = setInterval(() => {
        api<ProjectDetail>(`/projects/${project.id}`).then((p) => {
          const v = p.versions.find((x) => x.id === rerenderResult.version_id)
          if (v && v.status === 'done') {
            onSelect(v)
            clearInterval(t)
          }
        })
      }, 1500)
      setRerenderJob(null)
      return () => clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rerenderStream.done])

  useEffect(() => {
    setRegion(null)
    setPunchResult0()
    setShowAbc(false)
    setShowRelLyrics(false)
    setAbcDraft(version?.abc ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version?.id])

  function setPunchResult0() { /* placeholder to keep hook simple */ }

  if (!version || version.status !== 'done' || !version.urls) {
    return (
      <Card>
        <CardBody className="text-sm text-zinc-500">
          {version ? `版本 v${version.v} 状态:${version.status}` : '从左侧选择一个版本进入工作区'}
        </CardBody>
      </Card>
    )
  }

  const cfg = (version.config ?? {}) as Record<string, unknown>

  async function audition() {
    if (!region || !version) return
    setAuditioning(true)
    try {
      const res = await api<{ url: string }>(`/audition`, {
        method: 'POST',
        body: JSON.stringify({ version_id: version.id, region }),
      })
      if (!audioRef.current) audioRef.current = new Audio()
      audioRef.current.src = res.url
      await audioRef.current.play()
    } catch (e) {
      alert(String(e))
    } finally {
      setAuditioning(false)
    }
  }

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
        note: '改词重唱',
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
        note: '改谱重渲染',
      }),
    })
      .then((r) => setRerenderJob(r.job_id))
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
          title={`工作区 · v${version.v}`}
          desc={`${Math.round(version.duration ?? 0)}s · ${version.note || version.source}`}
          right={
            <button className="text-xs text-zinc-400 hover:text-emerald-400" onClick={() => setAbMode((s) => !s)}>
              {abMode ? '退出 A/B' : 'A/B 对比'}
            </button>
          }
        />
        <CardBody className="space-y-3">
          <WaveRegionsPlayer url={version.urls.audio} onRegionChange={setRegion} onDuration={setDuration} />
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            {region ? (
              <span className="rounded-md bg-emerald-500/10 px-2 py-1 font-mono text-emerald-400">
                选区 {region[0].toFixed(1)}s – {region[1].toFixed(1)}s({(region[1] - region[0]).toFixed(1)}s)
              </span>
            ) : (
              <span>在波形上拖选一段(≥1s)</span>
            )}
            <span className="flex-1" />
            <Button size="sm" variant="outline" disabled={!region || auditioning} onClick={audition}>
              {auditioning ? <Loader2 className="animate-spin" size={13} /> : <Play size={13} />} 试听选区
            </Button>
            <span className="flex items-center gap-1">
              <SelectMenu
                className="w-24"
                value={String(nCand)}
                onChange={(v) => setNCand(Number(v))}
                options={[2, 3, 4, 6].map((n) => ({ value: String(n), label: `${n} 候选` }))}
              />
              <Button size="sm" disabled={!region || !!punchJob && !punchStream.done} onClick={() => startPunch(nCand)}>
                <Scissors size={13} /> 挖补选区
              </Button>
            </span>
            <Button size="sm" disabled={!!punchJob && !punchStream.done} onClick={tailSing}>
              <Repeat size={13} /> 尾段重唱
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setShowRelLyrics((s) => !s); setRelLyrics(String(cfg.lyrics ?? '')) }}>
              <Repeat size={13} /> 改词重唱
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setShowAbc((s) => !s); setAbcDraft(version.abc ?? '') }}>
              <PencilRuler size={13} /> ABC 编辑
            </Button>
          </div>
        </CardBody>
      </Card>

      {punchJob && !punchStream.done && <JobPanel jobId={punchJob} events={punchStream.events} done={punchStream.done} title="挖补候选生成" />}

      {punchStream.done && punchResult && (
        <Card>
          <CardHeader
            title={`候选片段(${punchResult.seconds}s)`}
            desc={"同一乐谱内容的不同演绎,试听后采用" + (punchResult.snapped ? " · 已对齐小节线" : "")}
            right={<button className="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setPunchJob(null)}>收起</button>}
          />
          <CardBody className="space-y-2">
            {punchResult.candidates.map((c) => (
              <div key={c.idx} className="flex items-center gap-3 rounded-lg border border-zinc-800 p-2">
                <span className="w-14 shrink-0 font-mono text-xs text-zinc-400">#{c.idx + 1}</span>
                <span className="w-24 shrink-0 font-mono text-[11px] text-zinc-500">seed {c.seed}</span>
                <div className="min-w-0 flex-1"><AudioPlayer url={c.audition_url} height={36} /></div>
                <Button size="sm" disabled={!!applyJob && !applyStream.done} onClick={() => adopt(c.idx)}>
                  {applyJob && !applyStream.done ? <Loader2 className="animate-spin" size={13} /> : null} 采用拼回
                </Button>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {applyJob && !applyStream.done && <JobPanel jobId={applyJob} events={applyStream.events} done={applyStream.done} title="拼回新版本" />}

      {showRelLyrics && (
        <Card>
          <CardHeader title="改词重唱" desc="同 seed + 同乐谱 + 新歌词:旋律内容不变,整曲重新演绎(prefix 全局条件,任何改动都会重塑整首演唱)" />
          <CardBody className="space-y-3">
            <Textarea rows={9} value={relLyrics} onChange={(e) => setRelLyrics(e.target.value)} className="font-mono text-[13px]" />
            <Button disabled={!relLyrics.trim() || !!rerenderJob && !rerenderStream.done} onClick={startRelLyrics}>
              {rerenderJob && !rerenderStream.done ? <Loader2 className="animate-spin" size={14} /> : <Repeat size={14} />} 以原 seed 重唱
            </Button>
          </CardBody>
        </Card>
      )}

      {showAbc && (
        <Card>
          <CardHeader title="ABC 乐谱编辑" desc="改谱后整曲重渲染:新谱严格约束旋律与和弦,演绎为全新一版(挖补才是局部替换)" />
          <CardBody className="space-y-3">
            <Textarea rows={12} value={abcDraft} onChange={(e) => setAbcDraft(e.target.value)} className="font-mono text-[12px]" />
            <Notation abc={abcDraft} height={260} />
            <Button disabled={!!rerenderJob && !rerenderStream.done || !abcDraft.trim()} onClick={rerenderFull}>
              {rerenderJob && !rerenderStream.done ? <Loader2 className="animate-spin" size={14} /> : null} 重渲染整曲
            </Button>
          </CardBody>
        </Card>
      )}

      {rerenderJob && !rerenderStream.done && <JobPanel jobId={rerenderJob} events={rerenderStream.events} done={rerenderStream.done} title="改谱重渲染" />}

      {abMode && (
        <Card>
          <CardHeader title="A / B 对比" desc="选两个版本上下对听" />
          <CardBody className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {[['A', abA, setAbA] as const, ['B', abB, setAbB] as const].map(([label, val, set]) => (
                <div key={label}>
                  <SelectMenu
                    value={val ?? ''}
                    onChange={(v) => set(v || null)}
                    options={[
                      { value: '', label: `选择版本 ${label}` },
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
                  {duelJob && !duelStream.done ? <Loader2 className="animate-spin" size={13} /> : <Gauge size={13} />} 自动评测对比
                </Button>
                {duelJob && !duelStream.done && <JobPanel jobId={duelJob} events={duelStream.events} done={duelStream.done} title="评测" />}
                {duelStream.done && duelResult?.duel && (
                  <div className="overflow-hidden rounded-lg border border-zinc-800">
                    <table className="w-full text-xs">
                      <thead className="bg-zinc-900 text-zinc-400">
                        <tr><th className="px-2 py-1.5 text-left">指标</th><th className="px-2 py-1.5">A</th><th className="px-2 py-1.5">B</th><th className="px-2 py-1.5">占优</th></tr>
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
                      自动倾向:<span className="text-emerald-400">{duelResult.duel.auto_suggestion}</span>(最终以人耳对听为准)
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
          title={<span className="flex items-center gap-2"><Bot size={14} /> AI 改谱</span>}
          desc="自然语言指令 → 工具化改谱(移调/爵士和声/变速)→ diff 人审 → 重渲染"
          right={<button className="text-xs text-zinc-400 hover:text-emerald-400" onClick={() => setShowAgent((s) => !s)}>{showAgent ? '收起' : '展开'}</button>}
        />
        {showAgent && (
          <CardBody className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={agentInstruction}
                placeholder="例:整体升高一个全音,和弦加爵士七和弦,速度 110"
                onChange={(e) => setAgentInstruction(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runAgent()}
              />
              <Button disabled={!agentInstruction.trim() || !!agentJob && !agentStream.done} onClick={runAgent}>
                {agentJob && !agentStream.done ? <Loader2 className="animate-spin" size={14} /> : <Bot size={14} />} 执行
              </Button>
            </div>
            {agentJob && !agentStream.done && <JobPanel jobId={agentJob} events={agentStream.events} done={agentStream.done} title="改谱规划" />}
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
                <Button size="sm" onClick={adoptProposal}>采纳到编辑器(可再手改后重渲染)</Button>
              </div>
            )}
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="工件" />
        <CardBody className="flex flex-wrap gap-3 text-xs text-zinc-400">
          <a href={version.urls.audio} download className="hover:text-emerald-400">FLAC</a>
          <a href={version.urls.abc} target="_blank" rel="noreferrer" className="hover:text-emerald-400">ABC</a>
          <a href={version.urls.latents} download className="hover:text-emerald-400">隐变量</a>
          <a href={version.urls.semantic} download className="hover:text-emerald-400">语义 token</a>
          {cfg.abc_provided ? <span className="text-emerald-400/70">外部乐谱驱动</span> : null}
        </CardBody>
      </Card>
    </div>
  )
}
