import type {
  AiTeachingSettings,
  ExplanationMode,
} from '../../shared/types'
import { getSetting, setSetting } from './settings'

const SETTING_KEY = 'ai.explanationMode'

function normalizeMode(value: unknown): ExplanationMode {
  return value === 'english' ? 'english' : 'bilingual'
}

export function getAiTeachingSettings(): AiTeachingSettings {
  return {
    explanationMode: normalizeMode(getSetting(SETTING_KEY)),
  }
}

export function saveAiTeachingSettings(
  input: Partial<AiTeachingSettings>,
): AiTeachingSettings {
  const current = getAiTeachingSettings()
  const explanationMode = normalizeMode(
    input.explanationMode ?? current.explanationMode,
  )
  setSetting(SETTING_KEY, explanationMode)
  return { explanationMode }
}
