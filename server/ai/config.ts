import type { AiSettings } from '../../shared/types'
import { getSetting } from '../lib/settings'

export interface AiConfig {
  baseUrl: string
  model: string
  apiKey: string
  source: 'settings' | 'env' | 'none'
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-4o-mini'

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
