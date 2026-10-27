import { useEffect, useState } from 'react'
import { api, type UploadAsset } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { Label, Select } from './ui'

export function fmtDur(d?: number | null) {
  if (!d || d <= 0) return '—'
  return `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}`
}

/** 历史素材选择器:扒谱 / 翻唱 / 母带共用,免重复上传。选中即回调,选择器自身不带状态。 */
export function UploadPicker({ onPick, label, hint }: {
  onPick: (u: UploadAsset) => void
  label?: string
  hint?: string
}) {
  const t = useT()
  const [uploads, setUploads] = useState<UploadAsset[]>([])
  useEffect(() => {
    api<UploadAsset[]>('/uploads').then(setUploads).catch(() => {})
  }, [])
  return (
    <div>
      <Label hint={hint}>{label ?? t('已上传素材', 'Uploaded assets')}</Label>
      <Select
        aria-label={label ?? t('已上传素材', 'Uploaded assets')}
        value=""
        onChange={(e) => {
          const u = uploads.find((x) => x.id === e.target.value)
          if (u) onPick(u)
          e.target.value = ''
        }}
      >
        <option value="">{t('选择历史素材(免重复上传)…', 'Pick an uploaded asset (skip re-uploading)…')}</option>
        {uploads.filter((u) => u.exists).map((u) => (
          <option key={u.id} value={u.id}>
            {u.filename} · {fmtDur(u.duration)}
            {u.has_stems ? ` · ${t('已分轨', 'stems')}` : ''}
            {u.has_transcription ? ` · ${t('已扒谱', 'scored')}` : ''}
            {u.covers?.length ? ` · ${t('已翻唱', 'covered')}` : ''}
          </option>
        ))}
      </Select>
    </div>
  )
}
