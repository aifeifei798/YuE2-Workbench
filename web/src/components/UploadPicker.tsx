import { useEffect, useState } from 'react'
import { api, type UploadAsset } from '@/lib/api'
import { Label, Select } from './ui'

export function fmtDur(d?: number | null) {
  if (!d || d <= 0) return '—'
  return `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}`
}

/** 历史素材选择器:扒谱 / 翻唱 / 母带共用,免重复上传。选中即回调,选择器自身不带状态。 */
export function UploadPicker({ onPick, label = '已上传素材', hint }: {
  onPick: (u: UploadAsset) => void
  label?: string
  hint?: string
}) {
  const [uploads, setUploads] = useState<UploadAsset[]>([])
  useEffect(() => {
    api<UploadAsset[]>('/uploads').then(setUploads).catch(() => {})
  }, [])
  return (
    <div>
      <Label hint={hint}>{label}</Label>
      <Select
        aria-label={label}
        value=""
        onChange={(e) => {
          const u = uploads.find((x) => x.id === e.target.value)
          if (u) onPick(u)
          e.target.value = ''
        }}
      >
        <option value="">选择历史素材(免重复上传)…</option>
        {uploads.filter((u) => u.exists).map((u) => (
          <option key={u.id} value={u.id}>
            {u.filename} · {fmtDur(u.duration)}
            {u.has_stems ? ' · 已分轨' : ''}
            {u.has_transcription ? ' · 已扒谱' : ''}
            {u.covers?.length ? ' · 已翻唱' : ''}
          </option>
        ))}
      </Select>
    </div>
  )
}
