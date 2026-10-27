import { useCallback, useEffect, useState } from 'react'
import { Ear, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import { AudioPlayer } from '@/components/AudioPlayer'
import { Button, Card, CardBody, CardHeader, Page } from '@/components/ui'

type Pair = { a: { version_id: string; url: string }; b: { version_id: string; url: string } }
type Stats = {
  votes: number
  rows: {
    version_id: string
    project_id: string
    v: number
    note: string
    source: string
    elo: number
    wins: number
    losses: number
    ties: number
  }[]
}

export function BlindPage() {
  const [pair, setPair] = useState<Pair | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [showStats, setShowStats] = useState(true)
  const [voting, setVoting] = useState(false)

  const loadPair = useCallback(() => {
    setError(null)
    api<Pair>('/blind/pair').then(setPair).catch((e) => setError(String(e)))
  }, [])
  const loadStats = useCallback(() => api<Stats>('/blind/stats').then(setStats).catch(() => {}), [])

  useEffect(() => {
    loadPair()
    loadStats()
  }, [loadPair, loadStats])

  async function vote(winner: 'a' | 'b' | 'tie') {
    if (!pair || voting) return
    setVoting(true)
    try {
      await api('/blind/vote', {
        method: 'POST',
        body: JSON.stringify({ a: pair.a.version_id, b: pair.b.version_id, winner }),
      })
      await loadStats()
      loadPair()
    } catch (e) {
      alert(String(e))
    } finally {
      setVoting(false)
    }
  }

  return (
    <Page>
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Ear size={15} className="text-emerald-400" /> 盲听对决</span>}
          desc="同一素材的两个版本,标签只是 A/B —— 数据只属于你的耳朵"
          right={<span className="text-xs text-zinc-500">累计 {stats?.votes ?? 0} 票</span>}
        />
      </Card>

      {error ? (
        <Card>
          <CardBody className="flex items-center justify-between text-sm text-zinc-400">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={loadPair}><RefreshCw size={13} /> 重试</Button>
          </CardBody>
        </Card>
      ) : !pair ? (
        <div className="text-sm text-zinc-500">加载中…</div>
      ) : (
        <Card>
          <CardHeader
            title="这一轮,哪个更好听?"
            desc="不显示曲目信息;两边可以反复听,凭直觉选"
            right={
              <button className="text-xs text-zinc-400 hover:text-zinc-200" onClick={loadPair}>
                换一组
              </button>
            }
          />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {(['a', 'b'] as const).map((side) => (
              <div key={side} className="rounded-xl border border-zinc-800 p-3">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-sm font-medium text-zinc-200">选手 {side.toUpperCase()}</span>
                </div>
                <AudioPlayer url={pair[side].url} height={56} />
              </div>
            ))}
          </CardBody>
          <CardBody className="flex flex-wrap items-center justify-center gap-3 border-t border-zinc-800">
            <Button disabled={voting} onClick={() => vote('a')}>选 A</Button>
            <Button variant="outline" disabled={voting} onClick={() => vote('tie')}>难分伯仲</Button>
            <Button disabled={voting} onClick={() => vote('b')}>选 B</Button>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title={`口味排行(ELO · ${stats?.rows.length ?? 0} 首参与)`}
          desc="每次盲测投票实时更新;这是你的真实偏好,代理指标骗不了它"
          right={
            <button className="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setShowStats((s) => !s)}>
              {showStats ? '收起' : '展开'}
            </button>
          }
        />
        {showStats && (
          <CardBody className="p-0">
            {!stats || stats.rows.length === 0 ? (
              <div className="p-4 text-xs text-zinc-500">还没有投票。投几次之后,这里会给出你的口味排名。</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-zinc-900 text-zinc-400">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">作品</th>
                    <th className="px-3 py-2">版本</th>
                    <th className="px-3 py-2">ELO</th>
                    <th className="px-3 py-2">胜</th>
                    <th className="px-3 py-2">负</th>
                    <th className="px-3 py-2">平</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.rows.map((r, i) => (
                    <tr key={r.version_id} className="border-t border-zinc-800">
                      <td className="px-3 py-2 font-mono text-zinc-500">{i + 1}</td>
                      <td className="max-w-[240px] truncate px-3 py-2">
                        <a href={`#/projects/${r.project_id}`} className="text-zinc-200 hover:text-emerald-400">
                          {r.note || r.source}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-center text-zinc-500">v{r.v}</td>
                      <td className="px-3 py-2 text-center font-mono text-emerald-400">{r.elo}</td>
                      <td className="px-3 py-2 text-center text-zinc-400">{r.wins}</td>
                      <td className="px-3 py-2 text-center text-zinc-400">{r.losses}</td>
                      <td className="px-3 py-2 text-center text-zinc-400">{r.ties}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        )}
      </Card>
    </Page>
  )
}
