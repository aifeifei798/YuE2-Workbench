import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import { Pause, Play } from 'lucide-react'
import { Button } from './ui'

export function WaveRegionsPlayer({
  url,
  onRegionChange,
  onDuration,
  height = 96,
}: {
  url: string
  onRegionChange?: (region: [number, number] | null) => void
  onDuration?: (duration: number) => void
  height?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return
    const regions = RegionsPlugin.create()
    regionsRef.current = regions
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height,
      waveColor: '#52525b',
      progressColor: '#34d399',
      cursorColor: '#a1a1aa',
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      url,
      plugins: [regions],
    })
    wsRef.current = ws
    let hasRegion = false
    ws.on('ready', () => {
      setReady(true)
      onDuration?.(ws.getDuration())
      regions.enableDragSelection({ color: 'rgba(52, 211, 153, 0.18)' })
    })
    ws.on('play', () => setPlaying(true))
    ws.on('pause', () => setPlaying(false))
    ws.on('finish', () => setPlaying(false))
    const report = (r: { start: number; end: number }) => {
      if (r.end - r.start > 0.2) onRegionChange?.([r.start, r.end])
    }
    regions.on('region-created', (r: { start: number; end: number }) => {
      if (hasRegion) {
        // keep a single editable region
        regions.clearRegions()
      }
      hasRegion = true
      report(r as { start: number; end: number })
    })
    regions.on('region-updated', (r: { start: number; end: number }) => report(r as { start: number; end: number }))
    return () => {
      ws.destroy()
      wsRef.current = null
      regionsRef.current = null
      setReady(false)
      setPlaying(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, height])

  function playRegion() {
    const ws = wsRef.current
    if (!ws) return
    const rs = regionsRef.current?.getRegions()
    const r = rs && Object.values(rs)[0]
    if (r) {
      ws.setTime(r.start)
      ws.play()
      const stop = (window as unknown as { setInterval: typeof setInterval }).setInterval(() => {
        if (ws.getCurrentTime() >= r.end) {
          ws.pause()
          window.clearInterval(stop)
        }
      }, 100)
    } else {
      ws.playPause()
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        className="h-9 w-9 shrink-0 rounded-full p-0"
        disabled={!ready}
        onClick={() => {
          const rs = regionsRef.current?.getRegions()
          if (rs && Object.keys(rs).length > 0) playRegion()
          else wsRef.current?.playPause()
        }}
        aria-label={playing ? '暂停' : '播放'}
      >
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </Button>
      <div className="min-w-0 flex-1" ref={containerRef} />
    </div>
  )
}
