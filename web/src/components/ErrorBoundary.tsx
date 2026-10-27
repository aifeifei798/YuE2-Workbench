import { Component, type ReactNode } from 'react'
import { Ctx as LangContext } from '@/lib/i18n'

type State = { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  static contextType = LangContext
  declare context: { lang: 'zh' | 'en' }

  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('UI crash:', error)
  }

  render() {
    if (this.state.error) {
      const zh = this.context.lang !== 'en'
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="text-lg font-semibold text-zinc-100">{zh ? '页面出错了' : 'Something went wrong'}</div>
          <pre className="max-w-xl overflow-auto rounded-lg bg-zinc-900 p-3 text-left text-xs text-red-300">
            {String(this.state.error?.stack || this.state.error)}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
          >
            {zh ? '重试' : 'Retry'}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
