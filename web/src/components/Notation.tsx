import { useEffect, useRef, useState } from 'react'
import { onThemeChange, wavePalette } from '@/lib/theme'
import abcjs from 'abcjs'
import 'abcjs/abcjs-audio.css'

export function Notation({ abc, height = 420 }: { abc: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [themeTick, setThemeTick] = useState(0)
  useEffect(() => onThemeChange(() => setThemeTick((t) => t + 1)), [])
  useEffect(() => {
    if (!ref.current || !abc) return
    ref.current.innerHTML = ''
    try {
      abcjs.renderAbc(ref.current, abc, {
        responsive: 'resize',
        paddingtop: 8,
        paddingbottom: 8,
        foregroundColor: wavePalette().cursorColor,
      })
    } catch (e) {
      ref.current.textContent = `乐谱渲染失败: ${String(e)}`
    }
  }, [abc, themeTick])
  return (
    <div className="overflow-auto rounded-lg bg-zinc-950 p-3" style={{ maxHeight: height }}>
      <div ref={ref} />
    </div>
  )
}
