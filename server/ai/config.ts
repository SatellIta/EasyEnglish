import type { AiSettings } from '../../shared/types'
import { db } from '../db'

export interface AiConfig {
  baseUrl: string
  model: string
  apiKey: string
  source: 'settings' | 'env' | 'none'
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-4o-mini'

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value)
}

export function deleteSetting(key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}

export function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(url)
}

export function getAiConfig(): AiConfig {
  const dbBaseUrl = getSetting('ai.baseUrl')
  const dbModel = getSetting('ai.model')
  const dbApiKey = getSetting('ai.apiKey')

  const envBaseUrl = process.env.EASYENGLISH_BASE_URL
  const envModel = process.env.EASYENGLISH_MODEL
  const envApiKey = process.env.EASYENGLISH_API_KEY

  const baseUrl = (dbBaseUrl || envBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const model = dbModel || envModel || DEFAULT_MODEL
  const apiKey = dbApiKey || envApiKey || ''

  let source: AiConfig['source'] = 'none'
  if (dbBaseUrl || dbModel || dbApiKey) source = 'settings'
  else if (envBaseUrl || envModel || envApiKey) source = 'env'

  return { baseUrl, model, apiKey, source }
}

export function isConfigured(config = getAiConfig()): boolean {
  return Boolean(config.apiKey) || isLocalUrl(config.baseUrl)
}

export function maskApiKey(key: string): string | null {
  if (!key) return null
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}

export function publicSettings(): AiSettings {
  const config = getAiConfig()
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    hasApiKey: Boolean(config.apiKey),
    apiKeyMasked: maskApiKey(config.apiKey),
    configured: isConfigured(config),
    source: config.source,
  }
}
