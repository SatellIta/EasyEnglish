import type { Entry } from '@shared/types'
import { locale, t } from '@/i18n'

function intlLocale(): string {
  return locale.value === 'en' ? 'en-US' : 'zh-CN'
}

export function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  const diff = date.getTime() - Date.now()
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto' })

  if (abs < 45_000) return t('format.justNow')
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute')
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour')
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), 'day')
  return date.toLocaleDateString(intlLocale())
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale(), {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDue(iso: string): string {
  if (new Date(iso).getTime() <= Date.now()) return t('format.now')
  return formatRelativeTime(iso)
}

export function todayLongLabel(date = new Date()): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date)
}

export function startOfTodayIso(date = new Date()): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString()
}

export function stageLabel(stage: number): string {
  if (stage <= 0) return t('stage.new')
  return t('stage.nth', { stage })
}

export function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export interface DefinitionPreview {
  text: string
  kind: 'meaning' | 'english'
}

/**
 * 缩略释义按界面语言取默认值：
 * 英文界面优先英英释义，中文界面优先中文释义；缺失时回退到另一种。
 */
export function definitionPreview(
  entry: Pick<Entry, 'meaning' | 'englishDefinition'>,
  max = 180,
): DefinitionPreview | null {
  const englishFirst = locale.value === 'en'
  if (englishFirst) {
    if (entry.englishDefinition) {
      return { text: truncate(entry.englishDefinition, max), kind: 'english' }
    }
    if (entry.meaning) return { text: entry.meaning, kind: 'meaning' }
  } else {
    if (entry.meaning) return { text: entry.meaning, kind: 'meaning' }
    if (entry.englishDefinition) {
      return { text: truncate(entry.englishDefinition, max), kind: 'english' }
    }
  }
  return null
}
