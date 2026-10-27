import { useEffect, useState } from 'react'
import { HashRouter, Route, Routes, NavLink } from 'react-router-dom'
import { AudioLines, Disc3, Ear, FileAudio, FolderOpen, LibraryBig, LogOut, Mic2, Package, Settings, Sparkles, Trophy } from 'lucide-react'
import { ComposePage } from '@/pages/Compose'
import { ProjectsPage } from '@/pages/Projects'
import { ProjectPage } from '@/pages/Project'
import { TranscribePage } from '@/pages/Transcribe'
import { LibraryPage } from '@/pages/Library'
import { CoverPage } from '@/pages/Cover'
import { MasterPage } from '@/pages/Master'
import { UploadsPage } from '@/pages/Uploads'
import { BlindPage } from '@/pages/Blind'
import { LeaderboardPage } from '@/pages/Leaderboard'
import { SystemPage } from '@/pages/System'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { JobCenter } from '@/components/JobCenter'
import { LoginPage } from '@/components/LoginPage'
import { api } from '@/lib/api'

type Health = { status: string; models: { yue2: { loaded: boolean }; gpu?: { name: string; free_gb: number; total_gb: number } } }
type Me = { enabled: boolean; role: string | null }

function useMe(): [Me | null, (m: Me) => void] {
  const [me, setMe] = useState<Me | null>(null)
  useEffect(() => {
    api<Me>('/me').then(setMe).catch(() => setMe({ enabled: false, role: 'admin' }))
  }, [])
  return [me, setMe]
}

function Nav({ role }: { role: string | null }) {
  const [health, setHealth] = useState<Health | null>(null)
  useEffect(() => {
    const load = () => fetch('/api/healthz').then((r) => r.json()).then(setHealth).catch(() => setHealth(null))
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [])
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-5 px-5">
        <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <AudioLines size={17} className="text-emerald-400" /> YuE2 Workbench
        </span>
        <nav className="flex flex-nowrap items-center gap-1 overflow-x-auto text-sm">
          <NavLink to="/" title="创作台" end className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <Sparkles size={14} />
          </NavLink>
          <NavLink to="/projects" title="项目库" className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <FolderOpen size={14} />
          </NavLink>
          <NavLink to="/transcribe" title="扒谱" className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <FileAudio size={14} />
          </NavLink>
          <NavLink to="/uploads" title="素材" className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <Package size={14} />
          </NavLink>
          <NavLink to="/library" title="音乐库" className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <LibraryBig size={14} />
          </NavLink>
          <NavLink to="/cover" title="翻唱" className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <Mic2 size={14} />
          </NavLink>
          <NavLink to="/master" title="母带" className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <Disc3 size={14} />
          </NavLink>
          <NavLink to="/blind" title="盲听对决" className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <Ear size={14} />
          </NavLink>
          <NavLink to="/leaderboard" title="排行榜" className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <Trophy size={14} />
          </NavLink>
          {role === 'admin' && (
            <NavLink to="/system" title="系统/模型管理" className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
              <Settings size={14} />
            </NavLink>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-zinc-500">
          {health?.models?.gpu && (
            <span className="hidden sm:inline">
              {health.models.gpu.name} · 显存 {health.models.gpu.free_gb}/{health.models.gpu.total_gb} GB
            </span>
          )}
          <JobCenter />
          {role && (
            <button
              title={role === 'admin' ? '登出(管理员)' : '登出(只听)'}
              className="rounded-md p-1 text-zinc-500 hover:text-zinc-200"
              onClick={async () => {
                await api('/logout', { method: 'POST' }).catch(() => {})
                location.reload()
              }}
            >
              <LogOut size={14} />
            </button>
          )}
          <span className={`h-2 w-2 rounded-full ${health?.status === 'ok' ? 'bg-emerald-400' : 'bg-red-400'}`} />
        </div>
      </div>
    </header>
  )
}

export default function App() {
  const [me, setMe] = useMe()
  if (!me) return <div className="p-8 text-sm text-zinc-500">加载中…</div>
  if (me.enabled && !me.role) {
    return (
      <HashRouter>
        <LoginPage onLogin={(role) => setMe({ enabled: true, role })} />
      </HashRouter>
    )
  }
  return (
    <HashRouter>
      <div className="flex min-h-full flex-col">
        <Nav role={me.role} />
        <main className="flex-1">
          <ErrorBoundary>
          <Routes>
            <Route path="/" element={<ComposePage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectPage />} />
            <Route path="/transcribe" element={<TranscribePage />} />
            <Route path="/uploads" element={<UploadsPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/cover" element={<CoverPage />} />
            <Route path="/master" element={<MasterPage />} />
            <Route path="/blind" element={<BlindPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/system" element={<SystemPage />} />
          </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </HashRouter>
  )
}
