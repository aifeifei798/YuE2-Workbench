import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { Pause, Play } from 'lucide-react'
import { Button } from './ui'

export function AudioPlayer({ url, height = 72 }: { url: string; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return
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
    })
    wsRef.current = ws
    ws.on('ready', () => setReady(true))
    ws.on('play', () => setPlaying(true))
    ws.on('pause', () => setPlaying(false))
    ws.on('finish', () => setPlaying(false))
    return () => {
      ws.destroy()
      wsRef.current = null
      setReady(false)
      setPlaying(false)
    }
  }, [url, height])

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        className="h-9 w-9 shrink-0 rounded-full p-0"
        disabled={!ready}
        onClick={() => wsRef.current?.playPause()}
        aria-label={playing ? '暂停' : '播放'}
      >
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </Button>
      <div className="min-w-0 flex-1" ref={containerRef} />
    </div>
  )
}
