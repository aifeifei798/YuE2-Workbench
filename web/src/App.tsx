import { useEffect, useState } from 'react'
import { HashRouter, Route, Routes, NavLink } from 'react-router-dom'
import { AudioLines, Disc3, Ear, FileAudio, FolderOpen, Layers, LibraryBig, LogOut, Mic2, Moon, Package, Settings, Sparkles, Sun, Trophy } from 'lucide-react'
import { ComposePage } from '@/pages/Compose'
import { ProjectsPage } from '@/pages/Projects'
import { ProjectPage } from '@/pages/Project'
import { TranscribePage } from '@/pages/Transcribe'
import { LibraryPage } from '@/pages/Library'
import { CoverPage } from '@/pages/Cover'
import { MasterPage } from '@/pages/Master'
import { StemsPage } from '@/pages/Stems'
import { UploadsPage } from '@/pages/Uploads'
import { BlindPage } from '@/pages/Blind'
import { LeaderboardPage } from '@/pages/Leaderboard'
import { SystemPage } from '@/pages/System'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { JobCenter } from '@/components/JobCenter'
import { LoginPage } from '@/components/LoginPage'
import { api } from '@/lib/api'
import { currentTheme, onThemeChange, setTheme } from '@/lib/theme'
import { LangProvider, useLang, useT } from '@/lib/i18n'

type Health = { status: string; models: { yue2: { loaded: boolean }; gpu?: { name: string; free_gb: number; total_gb: number } } }
type Me = { enabled: boolean; role: string | null }

function useMe(): [Me | null, (m: Me) => void] {
  const [me, setMe] = useState<Me | null>(null)
  useEffect(() => {
    api<Me>('/me').then(setMe).catch(() => setMe({ enabled: false, role: 'admin' }))
  }, [])
  return [me, setMe]
}

function LangToggle() {
  const { lang, setLang } = useLang()
  return (
    <button
      title={lang === 'zh' ? 'Switch to English' : '切换到中文'}
      className="rounded-md px-1 text-[11px] font-semibold text-zinc-500 hover:text-zinc-200"
      onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
    >
      {lang === 'zh' ? 'EN' : '中'}
    </button>
  )
}

function ThemeToggle() {
  const t = useT()
  const [theme, setThemeState] = useState(currentTheme())
  useEffect(() => onThemeChange(setThemeState), [])
  const isLight = theme === 'light'
  return (
    <button
      title={isLight ? t('月亮模式(暗色)', 'Moon mode (dark)') : t('太阳模式(亮色)', 'Sun mode (light)')}
      className="rounded-md p-1 text-zinc-500 hover:text-zinc-200"
      onClick={() => setTheme(isLight ? 'dark' : 'light')}
    >
      {isLight ? <Moon size={14} /> : <Sun size={14} />}
    </button>
  )
}

function Nav({ role }: { role: string | null }) {
  const t = useT()
  const [health, setHealth] = useState<Health | null>(null)
  useEffect(() => {
    const load = () => fetch('/api/healthz').then((r) => r.json()).then(setHealth).catch(() => setHealth(null))
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [])
  return (
    <header className="z-10 shrink-0 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-5 px-5">
        <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <AudioLines size={17} className="text-emerald-400" /> YuE2 Workbench
        </span>
        <nav className="flex flex-nowrap items-center gap-1 overflow-x-auto text-sm">
          <NavLink to="/" title={t('创作台', 'Studio')} end className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <Sparkles size={14} />
          </NavLink>
          <NavLink to="/projects" title={t('项目库', 'Projects')} className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <FolderOpen size={14} />
          </NavLink>
          <NavLink to="/transcribe" title={t('扒谱', 'Transcribe')} className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <FileAudio size={14} />
          </NavLink>
          <NavLink to="/stems" title={t('分轨', 'Stems')} className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <Layers size={14} />
          </NavLink>
          <NavLink to="/uploads" title={t('素材', 'Assets')} className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <Package size={14} />
          </NavLink>
          <NavLink to="/library" title={t('音乐库', 'Library')} className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <LibraryBig size={14} />
          </NavLink>
          <NavLink to="/cover" title={t('翻唱', 'Cover')} className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <Mic2 size={14} />
          </NavLink>
          <NavLink to="/master" title={t('母带', 'Master')} className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <Disc3 size={14} />
          </NavLink>
          <NavLink to="/blind" title={t('盲听对决', 'Blind Test')} className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <Ear size={14} />
          </NavLink>
          <NavLink to="/leaderboard" title={t('排行榜', 'Leaderboard')} className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            <Trophy size={14} />
          </NavLink>
          {role === 'admin' && (
            <NavLink to="/system" title={t('系统/模型管理', 'System & Models')} className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
              <Settings size={14} />
            </NavLink>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-zinc-500">
          {health?.models?.gpu && (
            <span className="hidden sm:inline">
              {health.models.gpu.name} · {t('显存', 'VRAM')} {(health.models.gpu.total_gb - health.models.gpu.free_gb).toFixed(1)}/{health.models.gpu.total_gb} GB
            </span>
          )}
          <ThemeToggle />
          <LangToggle />
          <JobCenter />
          {role && (
            <button
              title={role === 'admin' ? t('登出(管理员)', 'Sign out (admin)') : t('登出(只听)', 'Sign out (listen-only)')}
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

function AppInner() {
  const t = useT()
  const [me, setMe] = useMe()
  if (!me) return <div className="p-8 text-sm text-zinc-500">{t("加载中…", "Loading…")}</div>
  if (me.enabled && !me.role) {
    return (
      <LangProvider>
        <HashRouter>
          <LoginPage onLogin={(role) => setMe({ enabled: true, role })} />
        </HashRouter>
      </LangProvider>
    )
  }
  return (
    <LangProvider>
    <HashRouter>
      <div className="flex h-dvh flex-col overflow-hidden">
        <Nav role={me.role} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <ErrorBoundary>
          <Routes>
            <Route path="/" element={<ComposePage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectPage />} />
            <Route path="/transcribe" element={<TranscribePage />} />
            <Route path="/stems" element={<StemsPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/cover" element={<CoverPage />} />
            <Route path="/master" element={<MasterPage />} />
            <Route path="/uploads" element={<UploadsPage />} />
            <Route path="/blind" element={<BlindPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/system" element={<SystemPage />} />
          </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </HashRouter>
    </LangProvider>
  )
}

export default function App() {
  return (
    <LangProvider>
      <AppInner />
    </LangProvider>
  )
}
