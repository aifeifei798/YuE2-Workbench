import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/job'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'default', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        variant === 'default' && 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400',
        variant === 'outline' && 'border border-zinc-700 bg-transparent text-zinc-100 hover:bg-zinc-800',
        variant === 'ghost' && 'bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100',
        variant === 'danger' && 'bg-red-500/90 text-white hover:bg-red-500',
        className,
      )}
      {...props}
    />
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-xl border border-zinc-800 bg-zinc-900/60', className)}>{children}</div>
}

export function CardHeader({ title, desc, right }: { title: ReactNode; desc?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
      <div>
        <div className="text-sm font-semibold text-zinc-100">{title}</div>
        {desc && <div className="mt-0.5 text-xs text-zinc-400">{desc}</div>}
      </div>
      {right}
    </div>
  )
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-4', className)}>{children}</div>
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none',
        className,
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none',
        className,
      )}
      {...props}
    />
  )
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none',
        className,
      )}
      {...props}
    />
  )
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between">
      <span className="text-xs font-medium text-zinc-300">{children}</span>
      {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
    </div>
  )
}

export function Progress({ value, className }: { value?: number | null; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-zinc-800', className)}>
      <div
        className={cn('h-full rounded-full bg-emerald-500 transition-all', value == null && 'animate-pulse w-1/3')}
        style={value != null ? { width: `${Math.min(100, value)}%` } : undefined}
      />
    </div>
  )
}

const badgeStyles: Record<string, string> = {
  done: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  running: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  queued: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  failed: 'bg-red-500/15 text-red-400 border-red-500/30',
  cancelled: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
}

export function Badge({ status, children }: { status?: string; children?: ReactNode }) {
  const s = status ?? 'queued'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        badgeStyles[s] ?? badgeStyles.queued,
      )}
    >
      {children ?? s}
    </span>
  )
}
