import { useEffect, useRef } from 'react'
import abcjs from 'abcjs'
import 'abcjs/abcjs-audio.css'

export function Notation({ abc, height = 420 }: { abc: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current || !abc) return
    ref.current.innerHTML = ''
    try {
      abcjs.renderAbc(ref.current, abc, {
        responsive: 'resize',
        paddingtop: 8,
        paddingbottom: 8,
        foregroundColor: '#d4d4d8',
      })
    } catch (e) {
      ref.current.textContent = `乐谱渲染失败: ${String(e)}`
    }
  }, [abc])
  return (
    <div className="overflow-auto rounded-lg bg-zinc-950 p-3" style={{ maxHeight: height }}>
      <div ref={ref} />
    </div>
  )
}
