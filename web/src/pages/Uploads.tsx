import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Disc3, FileAudio, Loader2, Mic2, Package, Play, Trash2, Upload, X } from 'lucide-react'
import { api, type UploadAsset } from '@/lib/api'
import { fmtDur } from '@/components/UploadPicker'
import { Badge, Button, Card, CardBody, CardHeader } from '@/components/ui'

function fmtSize(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`
}

function jumpBtn(to: string, title: string, icon: React.ReactNode) {
  return (
    <Link to={to} title={title} className="inline-flex">
      <Button size="sm" variant="ghost" className="h-8 w-8 p-0">{icon}</Button>
    </Link>
  )
}

export function UploadsPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploads, setUploads] = useState<UploadAsset[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState<UploadAsset | null>(null)

  const load = useCallback(() => {
    api<UploadAsset[]>('/uploads').then(setUploads).catch((e) => setError(String(e)))
  }, [])
  useEffect(() => { load() }, [load])

  async function pick(f: File | null) {
    if (!f) return
    setError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
      load()
    } catch (e) {
      setError(String(e))
    } finally {
      setUploading(false)
    }
  }

  async function remove(u: UploadAsset) {
    if (!confirm(`删除素材「${u.filename}」?\n它生成的分轨/扒谱缓存会一并删除;已导出的母带版本与翻唱项目不受影响。`)) return
    try {
      await api(`/uploads/${u.id}`, { method: 'DELETE' })
      if (playing?.id === u.id) setPlaying(null)
      load()
    } catch (e) {
      setError(String(e))
    }
  }

  function derivedBadges(u: UploadAsset) {
    const items: React.ReactNode[] = []
    if (u.has_stems) {
      items.push(
        <a key="stems" href={`/api/uploads/${u.id}/export/stems.zip`} download title="下载分轨 ZIP">
          <Badge status="done">分轨 ⬇</Badge>
        </a>,
      )
    }
    if (u.has_transcription) {
      items.push(
        <a key="trans" href={`/api/uploads/${u.id}/export/transcription.zip`} download title="下载扒谱 ZIP(ABC/MIDI/标注)">
          <Badge status="done">扒谱 ⬇</Badge>
        </a>,
      )
    }
    const cover = u.covers?.[u.covers.length - 1]
    if (cover) {
      items.push(
        <Link key={`cover-${cover.project_id}`} to={`/projects/${cover.project_id}`} title={`打开翻唱项目:${cover.title}${(u.covers?.length ?? 0) > 1 ? `(共 ${u.covers?.length} 个)` : ''}`}>
          <Badge status="done">翻唱 ↗</Badge>
        </Link>,
      )
    }
    const master = u.masters?.[u.masters.length - 1]
    if (master) {
      items.push(
        <a key={`master-${master.version_id}`} href={master.audio_url} download title={`下载母带 v${master.v} ${master.note}${(u.masters?.length ?? 0) > 1 ? `(共 ${u.masters?.length} 个)` : ''}`}>
          <Badge status="done">母带 ⬇</Badge>
        </a>,
      )
    }
    return items.length ? <div className="flex flex-wrap gap-1">{items}</div> : <span className="text-xs text-zinc-600">—</span>
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-5">
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Package size={15} /> 上传素材</span>}
          desc="扒谱 / 翻唱 / 母带共用的统一素材库:试听、复用、下载派生物、清理,一站管理"
        />
        <CardBody className="space-y-4">
          <input ref={fileRef} type="file" accept="audio/*" aria-label="上传素材文件" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; pick(f) }} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-700 py-7 text-sm text-zinc-400 transition-colors hover:border-emerald-500/50 hover:text-zinc-200 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="animate-spin" size={19} /> : <Upload size={19} />}
            上传音频素材
            <span className="text-xs text-zinc-600">mp3 / wav / flac / m4a / webm …,各功能页的上传也会登记到这里</span>
          </button>
          {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                  <th className="py-2 pr-3 font-medium">试听</th>
                  <th className="py-2 pr-3 font-medium">文件</th>
                  <th className="py-2 pr-3 font-medium">大小</th>
                  <th className="py-2 pr-3 font-medium">时长</th>
                  <th className="py-2 pr-3 font-medium">派生物</th>
                  <th className="py-2 pr-3 font-medium">上传时间</th>
                  <th className="py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((u) => (
                  <tr key={u.id} className={`border-b border-zinc-800/60 ${playing?.id === u.id ? 'bg-emerald-500/5' : ''}`}>
                    <td className="py-2 pr-3">
                      <button
                        aria-label={`试听 ${u.filename}`}
                        title={playing?.id === u.id ? '关闭试听' : '试听'}
                        onClick={() => setPlaying(playing?.id === u.id ? null : u)}
                        className={`flex h-8 w-8 items-center justify-center rounded-full border ${playing?.id === u.id ? 'border-emerald-500/50 text-emerald-400' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}
                      >
                        {playing?.id === u.id ? <X size={14} /> : <Play size={14} className="ml-0.5" />}
                      </button>
                    </td>
                    <td className="py-2 pr-3">
                      <a href={u.url ?? '#'} download className="text-zinc-200 hover:text-emerald-400">{u.filename}</a>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-zinc-400">{fmtSize(u.size)}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-zinc-400">{fmtDur(u.duration)}</td>
                    <td className="py-2 pr-3">{derivedBadges(u)}</td>
                    <td className="py-2 pr-3 text-xs text-zinc-500">{new Date(u.created_at * 1000).toLocaleString()}</td>
                    <td className="py-2 text-right">
                      {jumpBtn(`/transcribe?u=${u.id}`, '去扒谱', <FileAudio size={14} />)}
                      {jumpBtn(`/cover?u=${u.id}`, '去翻唱', <Mic2 size={14} />)}
                      {jumpBtn(`/master?u=${u.id}`, '去母带', <Disc3 size={14} />)}
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-zinc-500 hover:text-red-400" title="删除" onClick={() => remove(u)}>
                        <Trash2 size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
                {!uploads.length && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-sm text-zinc-500">还没有素材。在上面上传,或直接在扒谱 / 翻唱 / 母带页上传(都会登记到这里)</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {playing && (
        <div className="fixed bottom-5 left-1/2 z-20 w-[min(640px,92vw)] -translate-x-1/2 rounded-xl border border-zinc-700 bg-zinc-900/95 p-3 shadow-2xl backdrop-blur">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-zinc-200"><Play size={11} className="text-emerald-400" /> {playing.filename}</span>
            <button aria-label="关闭试听" className="rounded p-0.5 text-zinc-500 hover:text-zinc-200" onClick={() => setPlaying(null)}><X size={13} /></button>
          </div>
          <audio key={playing.id} src={playing.url ?? ''} controls autoPlay className="w-full" />
        </div>
      )}
    </div>
  )
}
