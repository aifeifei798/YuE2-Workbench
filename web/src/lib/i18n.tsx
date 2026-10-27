/** 轻量双语:调用点直接写中英对 t('生成歌曲', 'Generate'),无需 key 字典。
 *  语言持久化在 localStorage.wb_lang,默认跟随浏览器。 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Lang = 'zh' | 'en'

export const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: 'zh',
  setLang: () => {},
})

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('wb_lang')
    if (saved === 'zh' || saved === 'en') return saved
    return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  })
  useEffect(() => {
    localStorage.setItem('wb_lang', lang)
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])
  return <Ctx.Provider value={{ lang, setLang: (l) => setLangState(l) }}>{children}</Ctx.Provider>
}

export function useLang(): { lang: Lang; setLang: (l: Lang) => void } {
  return useContext(Ctx)
}

/** 组件内:const t = useT() */
export function useT() {
  const { lang } = useContext(Ctx)
  return (zh: string, en: string) => (lang === 'zh' ? zh : en)
}
