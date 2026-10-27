import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/job'

export type SelectOption = { value: string; label: string }

/** Custom dropdown — native <select> popups render detached in the in-app browser. */
export function SelectMenu({
  value,
  options,
  onChange,
  className,
}: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-[13px] text-zinc-100 hover:border-zinc-600 focus:border-emerald-500 focus:outline-none"
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown size={14} className={cn('shrink-0 text-zinc-500 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-60 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={cn(
                'block w-full truncate px-3 py-2 text-left text-sm hover:bg-zinc-800',
                o.value === value ? 'text-emerald-400' : 'text-zinc-200',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
