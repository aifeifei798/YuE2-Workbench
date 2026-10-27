/** 主题(月亮=暗 / 太阳=亮):CSS 重映射调色板,这里只负责切换与画布取色。 */

export type Theme = 'dark' | 'light'

export function currentTheme(): Theme {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark'
}

export function setTheme(t: Theme) {
  document.documentElement.classList.toggle('light', t === 'light')
  localStorage.setItem('wb_theme', t)
  window.dispatchEvent(new CustomEvent('wb-theme', { detail: t }))
}

export function initTheme() {
  const saved = localStorage.getItem('wb_theme')
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.classList.toggle('light', saved === 'light')
  }
}

export function onThemeChange(cb: (t: Theme) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<Theme>).detail)
  window.addEventListener('wb-theme', handler)
  return () => window.removeEventListener('wb-theme', handler)
}

/** wavesurfer 等画布组件的取色(不走 CSS,需要显式配色) */
export function wavePalette() {
  return currentTheme() === 'light'
    ? { waveColor: '#c9bfa8', progressColor: '#0e8a54', cursorColor: '#7b7160' }
    : { waveColor: '#52525b', progressColor: '#34d399', cursorColor: '#a1a1aa' }
}
