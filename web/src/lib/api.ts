export type Job = {
  id: string
  type: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string | null
  project_id?: string | null
  created_at: number
  started_at?: number | null
  finished_at?: number | null
}

export type VersionOut = {
  id: string
  v: number
  source: string
  parent_version_id?: string | null
  note: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  duration?: number | null
  abc?: string | null
  config?: Record<string, unknown> | null
  created_at: number
  urls?: { audio: string; abc: string; latents: string; semantic: string; lrc?: string; cover?: string } | null
}

export type ProjectSummary = {
  id: string
  title: string
  style: string
  cot: string
  seed?: number | null
  created_at: number
  version_count: number
}

export type ProjectDetail = ProjectSummary & {
  lyrics: string
  versions: VersionOut[]
  recent_jobs: { id: string; type: string; status: string; created_at: number }[]
}

export type GeneratePayload = {
  project_id?: string
  title?: string
  style: string
  lyrics: string
  cot: 'full' | 'melody' | 'off'
  seed?: number | null
  cfg_scale?: number | null
  note?: string
  parent_version_id?: string | null
  source?: string
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    if (res.status === 401) {
      // session expired: reload lands on the login gate (/api/me returns no role)
      location.reload()
      return new Promise<T>(() => {}) // page is going away
    }
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${text.slice(0, 300)}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export type JobEvent = {
  stage?: string
  detail?: string
  tokens?: number
  tps?: number
  status?: string
  error?: string | null
  result?: Record<string, unknown>
  t: number
}

export const TERMINAL = new Set(['done', 'failed', 'cancelled'])
