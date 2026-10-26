import type { JobEvent } from '@/lib/api'
import { Badge, Card, CardBody, CardHeader, Progress } from './ui'

const STAGE_LABEL: Record<string, string> = {
  load_model: '加载模型',
  plan: '规划乐谱 (ABC)',
  semantic: '生成歌曲 token',
  nar: '合成音频隐变量',
  vae: '解码音频',
  transcribe: '扒谱中',
  separate: '分离音轨',
  decode: '解码音频',
  embed: '特征提取',
  copy: '复制文件',
  done: '完成',
}

export function JobPanel({
  jobId,
  events,
  done,
  title = '任务进度',
  failedNote,
}: {
  jobId: string
  events: JobEvent[]
  done: boolean
  title?: string
  failedNote?: string
}) {
  const latest = [...events].reverse().find((e) => e.stage || e.detail) ?? events[events.length - 1]
  const failed = latest?.status === 'failed' || events.some((e) => e.status === 'failed')
  const status = failed ? 'failed' : done ? 'done' : 'running'
  const secs = events.length ? Math.round((Date.now() / 1000 - events[0].t)) : 0
  return (
    <Card>
      <CardHeader title={title} desc={`job ${jobId}`} right={<Badge status={status} />} />
      <CardBody className="space-y-3">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium text-zinc-200">
            {latest ? STAGE_LABEL[latest.stage ?? ''] ?? latest.stage : '排队中…'}
            {latest?.detail && <span className="ml-2 text-xs text-zinc-500">{latest.detail}</span>}
          </span>
          {!done && secs > 0 && <span className="text-xs text-zinc-500">{secs}s</span>}
        </div>
        <Progress value={done ? 100 : null} />
        {failed && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {failedNote ?? '任务失败,查看后端日志'}
          </div>
        )}
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer select-none">事件流 ({events.length})</summary>
          <div className="mt-2 max-h-40 space-y-0.5 overflow-auto rounded-lg bg-zinc-950 p-2 font-mono text-[11px]">
            {events.map((e, i) => (
              <div key={i}>{JSON.stringify(e)}</div>
            ))}
          </div>
        </details>
      </CardBody>
    </Card>
  )
}
