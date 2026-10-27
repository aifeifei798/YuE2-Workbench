import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import { Pause, Play } from 'lucide-react'
import { Button } from './ui'
import { onThemeChange, wavePalette } from '@/lib/theme'

export type WaveRegionsHandle = {
  /** move the playhead cursor to t (seconds) */
  setTime: (t: number) => void
  pause: () => void
}

export const WaveRegionsPlayer = forwardRef<WaveRegionsHandle, {
  url: string
  onRegionChange?: (region: [number, number] | null) => void
  onDuration?: (duration: number) => void
  /** fired when the waveform itself starts playing (e.g. to stop an external preview) */
  onPlay?: () => void
  height?: number
}>(function WaveRegionsPlayer({ url, onRegionChange, onDuration, onPlay, height = 96 }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null)
  const prevRegionRef = useRef<{ remove: () => void } | null>(null)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [themeTick, setThemeTick] = useState(0)

  useEffect(() => onThemeChange(() => setThemeTick((t) => t + 1)), [])

  useImperativeHandle(
    ref,
    () => ({
      setTime: (t: number) => wsRef.current?.setTime(t),
      pause: () => wsRef.current?.pause(),
    }),
    [],
  )

  useEffect(() => {
    if (!containerRef.current) return
    const regions = RegionsPlugin.create()
    regionsRef.current = regions
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height,
      ...wavePalette(),
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      url,
      plugins: [regions],
    })
    wsRef.current = ws
    ws.on('ready', () => {
      setReady(true)
      onDuration?.(ws.getDuration())
      regions.enableDragSelection({ color: 'rgba(52, 211, 153, 0.18)' })
    })
    ws.on('play', () => {
      setPlaying(true)
      onPlay?.()
    })
    ws.on('pause', () => setPlaying(false))
    ws.on('finish', () => setPlaying(false))
    const report = (r: { start: number; end: number }) => {
      if (r.end - r.start > 0.2) onRegionChange?.([r.start, r.end])
    }
    regions.on('region-created', (r: { start: number; end: number; remove: () => void }) => {
      // the plugin has already added the new region to its list when this fires:
      // drop only the previous one, or clearRegions() would erase the new region too
      if (prevRegionRef.current && prevRegionRef.current !== r) {
        prevRegionRef.current.remove()
      }
      prevRegionRef.current = r
      report(r)
    })
    regions.on('region-updated', (r: { start: number; end: number }) => report(r as { start: number; end: number }))
    return () => {
      prevRegionRef.current = null
      ws.destroy()
      wsRef.current = null
      regionsRef.current = null
      setReady(false)
      setPlaying(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, height, themeTick])

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        className="h-9 w-9 shrink-0 rounded-full p-0"
        disabled={!ready}
        onClick={() => wsRef.current?.playPause()}
        aria-label={playing ? '暂停' : '播放'}
        title="整首播放 / 暂停"
      >
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </Button>
      <div className="min-w-0 flex-1" ref={containerRef} />
    </div>
  )
})
