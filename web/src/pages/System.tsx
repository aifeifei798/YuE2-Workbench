import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, Settings, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { Button, Card, CardBody, CardHeader, Page } from '@/components/ui'
import { cn } from '@/lib/job'

type ModelRow = { name: string; label: string; repo: string; vram: string; loaded: boolean }

export function SystemPage() {
  const [rows, setRows] = useState<ModelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(() => {
    api<ModelRow[]>('/models').then(setRows).catch(() => {}).finally(() => setLoading(false))
  }, [])
  useEffect(refresh, [refresh])

  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => {
      api<ModelRow[]>('/models').then((rs) => {
        setRows(rs)
        if (rs.find((r) => r.name === busy)?.loaded) setBusy(null)
      }).catch(() => {})
    }, 3000)
    return () => clearInterval(t)
  }, [busy])

  async function load(name: string) {
    setBusy(name)
    try {
      await api(`/models/${name}/load`, { method: 'POST' })
    } catch (e) {
      alert(String(e))
      setBusy(null)
    }
  }

  async function unload(name: string) {
    setBusy(name)
    try {
      await api(`/models/${name}/unload`, { method: 'POST' })
      refresh()
      setBusy(null)
    } catch (e) {
      alert(String(e))
      setBusy(null)
    }
  }

  return (
    <Page className="flex h-full flex-col">
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader
          title={<span className="flex items-center gap-2"><Settings size={15} /> 系统 · 模型管理</span>}
          desc="模型按需懒加载,不手动加载也会在用到时自动载入;全部卸载后首次生成会重新加载 YuE2(约 10 秒)"
        />
        <CardBody className="min-h-0 flex-1 overflow-y-auto p-0">
          {loading && <div className="p-4 text-sm text-zinc-500">加载中…</div>}
          <div className="divide-y divide-zinc-800">
            {rows.map((m) => (
              <div key={m.name} className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-zinc-900/40">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-100">{m.label}</span>
                    <span className={`h-2 w-2 rounded-full ${m.loaded ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                    <span className="text-[11px] text-zinc-500">{m.loaded ? '已驻留' : '未加载'}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                    {m.repo} · 显存 {m.vram}
                  </div>
                </div>
                <div className="ml-4 flex shrink-0 items-center gap-2">
                  {m.loaded ? (
                    <Button size="sm" variant="outline" disabled={busy === m.name} onClick={() => unload(m.name)} title="从显存卸载,释放空间">
                      {busy === m.name ? <Loader2 className="animate-spin" size={13} /> : <Download size={13} />} 卸载
                    </Button>
                  ) : (
                    <Button size="sm" disabled={busy === m.name} onClick={() => load(m.name)} title="加载到显存">
                      {busy === m.name ? <Loader2 className="animate-spin" size={13} /> : <Upload size={13} />} 加载
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
      <p className={cn('text-xs text-zinc-500')}>
        说明:首次加载耗时从秒级到几分钟不等;装卸立即生效。
      </p>
    </Page>
  )
}
