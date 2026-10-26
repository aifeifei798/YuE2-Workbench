import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ProjectSummary } from '@/lib/api'
import { Button, Card, CardBody } from '@/components/ui'

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<ProjectSummary[]>('/projects')
      .then(setProjects)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="mx-auto max-w-4xl p-5">
      <h1 className="mb-4 text-lg font-semibold">项目库</h1>
      {loading && <div className="text-sm text-zinc-500">加载中…</div>}
      {!loading && projects.length === 0 && (
        <Card><CardBody className="text-sm text-zinc-500">还没有项目,去 <Link to="/" className="text-emerald-400 hover:underline">创作台</Link> 生成第一首歌。</CardBody></Card>
      )}
      <div className="space-y-2">
        {projects.map((p) => (
          <Card key={p.id} className="transition-colors hover:border-zinc-700">
            <CardBody className="flex items-center justify-between py-3">
              <div className="min-w-0">
                <Link to={`/projects/${p.id}`} className="block truncate text-sm font-medium text-zinc-100 hover:text-emerald-400">
                  {p.title}
                </Link>
                <div className="mt-0.5 truncate text-xs text-zinc-500">{p.style}</div>
              </div>
              <div className="ml-4 flex shrink-0 items-center gap-3 text-xs text-zinc-500">
                <span>{p.version_count} 版本</span>
                <span>{new Date(p.created_at * 1000).toLocaleString()}</span>
                <Button variant="ghost" size="sm" onClick={() => api(`/projects/${p.id}`, { method: 'DELETE' }).then(() => setProjects((ps) => ps.filter((x) => x.id !== p.id)))}>
                  删除
                </Button>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  )
}
