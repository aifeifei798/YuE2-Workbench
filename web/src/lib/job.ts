import { useEffect, useRef, useState } from 'react'
import { TERMINAL, type Job, type JobEvent } from './api'

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export function useJobStream(jobId: string | null) {
  const [events, setEvents] = useState<JobEvent[]>([])
  const [job, setJob] = useState<Job | null>(null)
  const [done, setDone] = useState(false)
  const lastResult = useRef<Record<string, unknown> | undefined>(undefined)

  useEffect(() => {
    if (!jobId) {
      setEvents([])
      setJob(null)
      setDone(false)
      lastResult.current = undefined
      return
    }
    // drop any state left over from the previous job so its result
    // can never shadow the new job's result
    setEvents([])
    setJob(null)
    setDone(false)
    lastResult.current = undefined

    let alive = true
    let pollTimer: ReturnType<typeof setInterval> | undefined
    const es = new EventSource(`/api/jobs/${jobId}/events`)

    const adopt = (j: Job) => {
      if (!alive) return
      setJob(j)
      if (j.result) lastResult.current = j.result
      if (TERMINAL.has(j.status)) {
        setDone(true)
        if (pollTimer) {
          clearInterval(pollTimer)
          pollTimer = undefined
        }
        es.close()
      }
    }

    const fetchJob = () =>
      fetch(`/api/jobs/${jobId}`)
        .then((r) => (r.ok ? (r.json() as Promise<Job>) : Promise.reject(new Error(String(r.status)))))
        .then(adopt)
        .catch(() => {})

    es.onmessage = (e) => {
      let ev: JobEvent
      try {
        ev = JSON.parse(e.data) as JobEvent
      } catch {
        return
      }
      if (!alive) return
      setEvents((prev) => [...prev.slice(-120), ev])
      if (ev.result) lastResult.current = ev.result
      if (ev.status && TERMINAL.has(ev.status)) {
        setDone(true)
        es.close()
        fetchJob()
      }
    }
    es.onerror = () => {
      // stream lost (backend restart / proxy hiccup): fall back to polling
      // until the job reaches a terminal state instead of hanging forever
      es.close()
      if (!alive || pollTimer) return
      fetchJob()
      pollTimer = setInterval(fetchJob, 2000)
    }
    return () => {
      alive = false
      es.close()
      if (pollTimer) clearInterval(pollTimer)
    }
  }, [jobId])

  return { events, job, done, result: job?.result ?? lastResult.current }
}
