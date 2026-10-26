import { useCallback, useEffect, useRef, useState } from 'react'
import { Ban, Bell, BellOff, ClipboardList, RotateCcw, Trash2, X } from 'lucide-react'
import { api, type Job } from '@/lib/api'
import { useJobStream } from '@/lib/job'
import { JobPanel } from './JobPanel'
import { Badge } from './ui'

export const JOB_TYPE_LABEL: Record<string, string> = {
  generate: '生成歌曲',
  plan: '规划乐谱',
  transcribe: '扒谱',
  stems: '分轨',
  library_import: '入库分析',
  cover_prepare: '翻唱准备',
  punch: '挖补候选',
  punch_apply: '拼回',
  agent_edit: 'AI 改谱',
  evaluate: '评测',
  evaluate_batch: '批量评测',
  lyrics: '歌词转写',
  analyze: '分析',
  model_load: '模型加载',
}

const ACTIVE = new Set(['queued', 'running'])
const TERMINAL = new Set(['done', 'failed', 'cancelled'])

function age(ts: number) {
  const s = Math.max(0, Date.now() / 1000 - ts)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`
  if (s < 86400) return `${Math.round(s / 3600)} 小时前`
  return new Date(ts * 1000).toLocaleDateString()
}

export function JobCenter() {
  const [open, setOpen] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [notify, setNotify] = useState(() => localStorage.getItem('wb_notify') === '1')
  const [expanded, setExpanded] = useState<string | null>(null)
  const prevStatus = useRef<Map<string, string>>(new Map())

  const refresh = useCallback(() => {
    api<Job[]>('/jobs?limit=30')
      .then((rows) => {
        if (notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          for (const j of rows) {
            const before = prevStatus.current.get(j.id)
            if (before && ACTIVE.has(before) && TERMINAL.has(j.status) && !TERMINAL.has(before)) {
              const label = JOB_TYPE_LABEL[j.type] ?? j.type
              const body =
                j.status === 'done'
                  ? `${label} 完成${j.finished_at && j.started_at ? `,用时 ${Math.round(j.finished_at - j.started_at)}s` : ''}`
                  : `${label} 失败:${(j.error ?? '').slice(0, 120)}`
              try {
                const n = new Notification('YuE2 Workbench', { body })
                n.onclick = () => {
                  window.focus()
                  n.close()
                }
              } catch {
                /* notification failures are non-fatal */
              }
            }
          }
        }
        const m = new Map<string, string>()
        for (const j of rows) m.set(j.id, j.status)
        prevStatus.current = m
        setJobs(rows)
      })
      .catch(() => {})
  }, [notify])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, open ? 2500 : 8000)
    return () => clearInterval(t)
  }, [refresh, open])

  function toggleNotify() {
    if (notify) {
      localStorage.setItem('wb_notify', '0')
      setNotify(false)
      return
    }
    if (typeof Notification === 'undefined') {
      alert('此环境不支持浏览器通知')
      return
    }
    Notification.requestPermission().then((p) => {
      if (p === 'granted') {
        localStorage.setItem('wb_notify', '1')
        setNotify(true)
      } else {
        alert('浏览器拒绝了通知权限,请在地址栏设置里允许')
      }
    })
  }

  const cancel = (id: string) => api(`/jobs/${id}/cancel`, { method: 'POST' }).then(refresh).catch((e) => alert(String(e)))
  const retry = (id: string) => api<{ job_id: string }>(`/jobs/${id}/retry`, { method: 'POST' }).then(refresh).catch((e) => alert(String(e)))
  const remove = (id: string) => api(`/jobs/${id}`, { method: 'DELETE' }).then(refresh).catch((e) => alert(String(e)))

  const active = jobs.filter((j) => ACTIVE.has(j.status)).length

  return (
    <>
      <button
        onClick={() => setOpen((s) => !s)}
        title="任务中心"
        className={`relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 ${
          open ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <ClipboardList size={16} />
        {active > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-semibold text-zinc-950">
            {active}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="fixed right-0 top-12 z-30 flex max-h-[calc(100vh-3rem)] w-[420px] max-w-[92vw] flex-col rounded-l-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
              <span className="flex-1 text-sm font-semibold text-zinc-100">任务中心</span>
              <button
                onClick={toggleNotify}
                title={notify ? '关闭完成提醒' : '任务完成时弹浏览器通知'}
                className={`rounded-md p-1.5 ${notify ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                {notify ? <Bell size={15} /> : <BellOff size={15} />}
              </button>
              <button onClick={() => setOpen(false)} className="rounded-md p-1.5 text-zinc-500 hover:text-zinc-300">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-auto p-3">
              {jobs.length === 0 && <div className="p-4 text-center text-xs text-zinc-500">还没有任务记录</div>}
              {jobs.map((j) => {
                const label = JOB_TYPE_LABEL[j.type] ?? j.type
                const seed = (j.params as Record<string, unknown> | null)?.seed
                return (
                  <div key={j.id} className="rounded-lg border border-zinc-800 p-2.5">
                    <div className="flex items-center gap-2">
                      <Badge status={j.status} />
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                        {label}
                        {seed != null && <span className="ml-1.5 font-mono text-[11px] text-zinc-500">seed {String(seed)}</span>}
                      </span>
                      <span className="shrink-0 text-[11px] text-zinc-500">{age(j.created_at)}</span>
                    </div>
                    {j.error && <div className="mt-1 line-clamp-2 text-[11px] text-red-400">{j.error}</div>}
                    <div className="mt-1.5 flex items-center gap-3 text-[11px] text-zinc-500">
                      {ACTIVE.has(j.status) && (
                        <button className="hover:text-amber-400" onClick={() => cancel(j.id)}>
                          <Ban size={11} className="mr-0.5 inline" /> 取消
                        </button>
                      )}
                      {j.status === 'failed' && (
                        <button className="hover:text-emerald-400" onClick={() => retry(j.id)}>
                          <RotateCcw size={11} className="mr-0.5 inline" /> 重试
                        </button>
                      )}
                      {TERMINAL.has(j.status) && (
                        <button className="hover:text-red-400" onClick={() => remove(j.id)}>
                          <Trash2 size={11} className="mr-0.5 inline" /> 清除
                        </button>
                      )}
                      <span className="flex-1" />
                      <button
                        className="hover:text-zinc-200"
                        onClick={() => setExpanded(expanded === j.id ? null : j.id)}
                      >
                        {expanded === j.id ? '收起详情' : '详情'}
                      </button>
                    </div>
                    {expanded === j.id && (
                      <div className="mt-2">
                        <ExpandedJob jobId={j.id} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </>
  )
}

function ExpandedJob({ jobId }: { jobId: string }) {
  const { events, done } = useJobStream(jobId)
  return <JobPanel jobId={jobId} events={events} done={done} title="任务详情" />
}
