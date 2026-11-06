import { ref } from 'vue'
import type { EntryType, ErrorCategory, Persona } from '@shared/types'
import { en, zh, type MessageKey } from './messages'

export type Locale = 'zh' | 'en'

const STORAGE_KEY = 'easyenglish.locale'

function readInitialLocale(): Locale {
  if (typeof localStorage !== 'undefined') {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === 'zh' || saved === 'en') return saved
    } catch {
      // ignore
    }
  }
  if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('en')) {
    return 'en'
  }
  return 'zh'
}

export const locale = ref<Locale>(readInitialLocale())

function applyHtmlLang(value: Locale) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = value === 'en' ? 'en' : 'zh-CN'
    document.title = t('app.documentTitle')
  }
}

applyHtmlLang(locale.value)

export function setLocale(next: Locale): void {
  locale.value = next
  applyHtmlLang(next)
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // ignore private-mode storage errors
  }
}

export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const catalog = locale.value === 'en' ? en : zh
  let text: string = catalog[key] ?? zh[key] ?? key
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

export function entryTypeLabel(type: EntryType): string {
  return t(`entryType.${type}` as MessageKey)
}

export function errorCategoryLabel(category: ErrorCategory): string {
  return t(`errorCategory.${category}` as MessageKey)
}

export function personaName(persona: Persona): string {
  if (persona.isDefault && persona.key) {
    const key = `persona.default.${persona.key}.name` as MessageKey
    if (key in zh) return t(key)
  }
  return persona.name
}

export function personaDescription(persona: Persona): string {
  if (persona.isDefault && persona.key) {
    const key = `persona.default.${persona.key}.description` as MessageKey
    if (key in zh) return t(key)
  }
  return persona.description ?? ''
}

const EXACT_ERRORS: Record<string, MessageKey> = {
  对话不存在: 'api.chatNotFound',
  词条不存在: 'api.entryNotFound',
  场景不存在: 'api.sceneNotFound',
  人格不存在: 'api.personaNotFound',
  默认人格不能删除: 'api.defaultPersonaCannotDelete',
  消息不能为空: 'api.messageRequired',
  内容不能为空: 'api.textRequired',
  场景名不能为空: 'api.sceneNameRequired',
  '请求参数不合法': 'api.invalidRequest',
  '该词条不在场景中': 'api.entryNotInScene',
  '只有默认人格可以恢复默认': 'api.defaultPersonaResetOnly',
  人格名称不能为空: 'api.personaNameRequired',
  人格提示词不能为空: 'api.personaPromptRequired',
  'AI 没有返回可用的例句，请稍后重试。': 'api.examplesEmpty',
}

/** 英文界面下把后端常见中文错误转成英文；无法识别时避免泄漏中文。 */
export function localizeServerError(raw: string): string {
  if (locale.value !== 'en') return raw

  const exact = EXACT_ERRORS[raw.trim()]
  if (exact) return t(exact)

  if (raw.includes('AI 尚未配置')) return t('api.aiNotConfigured')
  if (raw.includes('对话不存在')) return t('api.chatNotFound')
  if (raw.includes('词条不存在')) return t('api.entryNotFound')
  if (raw.includes('场景不存在')) return t('api.sceneNotFound')
  if (raw.includes('人格不存在')) return t('api.personaNotFound')
  if (raw.includes('默认人格不能删除')) return t('api.defaultPersonaCannotDelete')
  if (raw.includes('消息不能为空')) return t('api.messageRequired')
  if (raw.includes('内容不能为空')) return t('api.textRequired')
  if (raw.includes('场景名不能为空')) return t('api.sceneNameRequired')
  if (raw.includes('人格名称不能为空')) return t('api.personaNameRequired')
  if (raw.includes('人格提示词不能为空')) return t('api.personaPromptRequired')
  if (raw.includes('今天还没有学习记录')) return t('api.noStudyRecords')
  if (raw.includes('词库中已存在相同的英文内容')) return t('export.duplicateEntry')
  if (raw.includes('没有返回可用的例句')) return t('api.examplesEmpty')
  if (raw.startsWith('AI 整理失败：')) {
    return t('api.summaryFailed', { message: raw.slice('AI 整理失败：'.length) })
  }
  if (raw.startsWith('生成例句失败：')) {
    return t('api.examplesFailed', { message: raw.slice('生成例句失败：'.length) })
  }

  const sceneExists = raw.match(/场景「(.+)」已存在/)
  if (sceneExists) return t('api.sceneExists', { name: sceneExists[1] })

  if (raw.includes('无效的')) return t('api.invalidRequest')

  if (/[一-鿿]/.test(raw)) return t('api.genericError')
  return raw
}
