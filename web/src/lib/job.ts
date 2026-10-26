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
      return
    }
    setEvents([])
    setDone(false)
    const es = new EventSource(`/api/jobs/${jobId}/events`)
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data) as JobEvent
      setEvents((prev) => [...prev.slice(-120), ev])
      if (ev.result) lastResult.current = ev.result
      if (ev.status && TERMINAL.has(ev.status)) {
        setDone(true)
        es.close()
        fetch(`/api/jobs/${jobId}`)
          .then((r) => r.json())
          .then(setJob)
          .catch(() => {})
      }
    }
    es.onerror = () => {
      // backend restart or finished stream: fall back to polling once
      es.close()
      fetch(`/api/jobs/${jobId}`)
        .then((r) => r.json())
        .then((j: Job) => {
          setJob(j)
          setDone(TERMINAL.has(j.status))
        })
        .catch(() => {})
    }
    return () => es.close()
  }, [jobId])

  return { events, job, done, result: job?.result ?? lastResult.current }
}
