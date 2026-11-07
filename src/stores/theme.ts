import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { MessageKey } from '@/i18n/messages'

export type ThemeId = 'neumorphism' | 'swiss'
export type ColorMode = 'light' | 'dark'

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
const COLOR_MODE_STORAGE_KEY = 'easyenglish.colorMode'

function readStoredTheme(): ThemeId {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'swiss' ? 'swiss' : 'neumorphism'
  } catch {
    return 'neumorphism'
  }
}

function readStoredColorMode(): ColorMode {
  try {
    return localStorage.getItem(COLOR_MODE_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function browserChromeColor(nextTheme: ThemeId, nextMode: ColorMode): string {
  if (nextTheme === 'swiss') return nextMode === 'dark' ? '#111111' : '#ffffff'
  return nextMode === 'dark' ? '#22262c' : '#e0e5ec'
}

export const useThemeStore = defineStore('theme', () => {
  const theme = ref<ThemeId>(readStoredTheme())
  const colorMode = ref<ColorMode>(readStoredColorMode())
  const isSwiss = computed(() => theme.value === 'swiss')
  const isDark = computed(() => colorMode.value === 'dark')

  function syncBrowserChrome(nextTheme: ThemeId, nextMode: ColorMode): void {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', browserChromeColor(nextTheme, nextMode))
  }

  function persistColorMode(next: ColorMode): void {
    try {
      localStorage.setItem(COLOR_MODE_STORAGE_KEY, next)
    } catch {
      // 忽略隐私模式下的存储错误
    }
  }

  function apply(next: ThemeId): void {
    theme.value = next
    document.documentElement.dataset.theme = next
    document.documentElement.dataset.mode = colorMode.value
    syncBrowserChrome(next, colorMode.value)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // 忽略隐私模式下的存储错误
    }
    persistColorMode(colorMode.value)
  }

  function applyColorMode(next: ColorMode): void {
    colorMode.value = next
    document.documentElement.dataset.mode = next
    syncBrowserChrome(theme.value, next)
    persistColorMode(next)
  }

  function setTheme(next: ThemeId): void {
    apply(next)
  }

  function setColorMode(next: ColorMode): void {
    applyColorMode(next)
  }

  function toggleTheme(): void {
    apply(theme.value === 'swiss' ? 'neumorphism' : 'swiss')
  }

  function toggleColorMode(): void {
    applyColorMode(colorMode.value === 'dark' ? 'light' : 'dark')
  }

  function initTheme(): void {
    document.documentElement.dataset.theme = theme.value
    document.documentElement.dataset.mode = colorMode.value
    syncBrowserChrome(theme.value, colorMode.value)
  }

  return {
    theme,
    colorMode,
    isSwiss,
    isDark,
    setTheme,
    toggleTheme,
    setColorMode,
    toggleColorMode,
    initTheme,
  }
})
