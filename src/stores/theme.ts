import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type ThemeId = 'neumorphism' | 'swiss'

export interface ThemeOption {
  id: ThemeId
  name: string
  description: string
}

export const THEMES: ThemeOption[] = [
  {
    id: 'neumorphism',
    name: '新拟物派',
    description: '柔和的双光源阴影，同色系表面，安静可触。',
  },
  {
    id: 'swiss',
    name: '瑞士国际风格',
    description: '严格网格、黑白与红色、Helvetica 式排版。',
  },
]

const STORAGE_KEY = 'easyenglish.theme'

function readStoredTheme(): ThemeId {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'swiss' ? 'swiss' : 'neumorphism'
  } catch {
    return 'neumorphism'
  }
}

export const useThemeStore = defineStore('theme', () => {
  const theme = ref<ThemeId>(readStoredTheme())
  const isSwiss = computed(() => theme.value === 'swiss')

  function syncBrowserChrome(next: ThemeId): void {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', next === 'swiss' ? '#ffffff' : '#e0e5ec')
  }

  function apply(next: ThemeId): void {
    theme.value = next
    document.documentElement.dataset.theme = next
    syncBrowserChrome(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // 忽略隐私模式下的存储错误
    }
  }

  function setTheme(next: ThemeId): void {
    apply(next)
  }

  function toggleTheme(): void {
    apply(theme.value === 'swiss' ? 'neumorphism' : 'swiss')
  }

  function initTheme(): void {
    document.documentElement.dataset.theme = theme.value
    syncBrowserChrome(theme.value)
  }

  return { theme, isSwiss, setTheme, toggleTheme, initTheme }
})
