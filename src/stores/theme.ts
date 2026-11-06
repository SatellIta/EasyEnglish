import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { MessageKey } from '@/i18n/messages'

export type ThemeId = 'neumorphism' | 'swiss'

export interface ThemeOption {
  id: ThemeId
  nameKey: MessageKey
  descriptionKey: MessageKey
}

export const THEMES: ThemeOption[] = [
  {
    id: 'neumorphism',
    nameKey: 'theme.neumorphism.name',
    descriptionKey: 'theme.neumorphism.description',
  },
  {
    id: 'swiss',
    nameKey: 'theme.swiss.name',
    descriptionKey: 'theme.swiss.description',
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
