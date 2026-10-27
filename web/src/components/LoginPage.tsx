import { useState } from 'react'
import { useT } from '@/lib/i18n'
import { AudioLines, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Button, Card, CardBody, Input } from './ui'

export function LoginPage({ onLogin }: { onLogin: (role: string) => void }) {
  const t = useT()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!password.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ role: string }>('/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      onLogin(res.role)
    } catch (e) {
      setError(String(e).replace(/^Error\([^)]*\):?\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-3rem)] items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardBody className="space-y-4 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <AudioLines size={17} className="text-emerald-400" /> YuE2 Workbench
          </div>
          <div className="text-xs text-zinc-500">{t('请输入访问密码', 'Enter the access password')}</div>
          <Input
            type="password"
            autoFocus
            value={password}
            placeholder={t('密码', 'Password')}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
          <Button className="w-full" onClick={submit} disabled={busy || !password.trim()}>
            {busy ? <Loader2 className="animate-spin" size={15} /> : null} {t('进入', 'Enter')}
          </Button>
        </CardBody>
      </Card>
    </div>
  )
}
