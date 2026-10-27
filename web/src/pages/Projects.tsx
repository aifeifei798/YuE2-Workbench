import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderOpen, Trash2 } from 'lucide-react'
import { api, type ProjectSummary } from '@/lib/api'
import { Button, Card, CardBody, CardHeader, Page } from '@/components/ui'
import { useT } from '@/lib/i18n'

export function ProjectsPage() {
  const t = useT()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<ProjectSummary[]>('/projects')
      .then(setProjects)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <Page className="flex h-full flex-col">
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader
          title={<span className="flex items-center gap-2"><FolderOpen size={15} /> {t('项目库', 'Projects')}</span>}
          desc={t('每次创作都是一个项目,里面按版本演进;点进项目可试听、挖补、改谱、母带', 'Every creation is a project that evolves by version — open one to audition, punch, re-score or master')}
        />
        <CardBody className="min-h-0 flex-1 overflow-y-auto p-0">
          {loading && <div className="p-4 text-sm text-zinc-500">{t('加载中…', 'Loading…')}</div>}
          {!loading && projects.length === 0 && (
            <div className="p-4 text-sm text-zinc-500">
              {t('还没有项目,去', 'No projects yet — head to')} <Link to="/" className="text-emerald-400 hover:underline">{t('创作台', 'Studio')}</Link> {t('生成第一首歌。', 'and create your first song.')}
            </div>
          )}
          <div className="divide-y divide-zinc-800">
            {projects.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3 transition-colors first:border-t-0 hover:bg-zinc-900/40">
                <div className="min-w-0">
                  <Link to={`/projects/${p.id}`} className="block truncate text-sm font-medium text-zinc-100 hover:text-emerald-400">
                    {p.title}
                  </Link>
                  <div className="mt-0.5 truncate text-xs text-zinc-500">{p.style}</div>
                </div>
                <div className="ml-4 flex shrink-0 items-center gap-3 text-xs text-zinc-500">
                  <span>{p.version_count} {t('版本', 'versions')}</span>
                  <span>{new Date(p.created_at * 1000).toLocaleString()}</span>
                  <Button variant="ghost" size="sm" title={t('删除', 'Delete')} className="h-8 w-8 p-0" onClick={() => api(`/projects/${p.id}`, { method: 'DELETE' }).then(() => setProjects((ps) => ps.filter((x) => x.id !== p.id))).catch((e) => alert(String(e)))}>
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </Page>
  )
}
