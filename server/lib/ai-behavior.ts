import type { AiBehaviorSettings } from '../../shared/types'
import { getSetting, setSetting } from './settings'

export const DEFAULT_AI_BEHAVIOR: AiBehaviorSettings = {
  memoryLimit: 12,
  historyLimit: 20,
  memoryCharBudget: 2400,
}

const LIMITS = {
  memoryLimit: { min: 1, max: 30 },
  historyLimit: { min: 2, max: 50 },
  memoryCharBudget: { min: 200, max: 12000 },
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (value === null || value === undefined || value === '') return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(Math.max(Math.round(number), min), max)
}

/** 读取 AI 上下文预算；数据库值非法时回退默认值。 */
export function getAiBehaviorSettings(): AiBehaviorSettings {
  return {
    memoryLimit: clampInt(
      getSetting('ai.memoryLimit'),
      DEFAULT_AI_BEHAVIOR.memoryLimit,
      LIMITS.memoryLimit.min,
      LIMITS.memoryLimit.max,
    ),
    historyLimit: clampInt(
      getSetting('ai.historyLimit'),
      DEFAULT_AI_BEHAVIOR.historyLimit,
      LIMITS.historyLimit.min,
      LIMITS.historyLimit.max,
    ),
    memoryCharBudget: clampInt(
      getSetting('ai.memoryCharBudget'),
      DEFAULT_AI_BEHAVIOR.memoryCharBudget,
      LIMITS.memoryCharBudget.min,
      LIMITS.memoryCharBudget.max,
    ),
  }
}

export function saveAiBehaviorSettings(
  input: Partial<AiBehaviorSettings>,
): AiBehaviorSettings {
  const current = getAiBehaviorSettings()
  const next: AiBehaviorSettings = {
    memoryLimit: clampInt(
      input.memoryLimit ?? current.memoryLimit,
      current.memoryLimit,
      LIMITS.memoryLimit.min,
      LIMITS.memoryLimit.max,
    ),
    historyLimit: clampInt(
      input.historyLimit ?? current.historyLimit,
      current.historyLimit,
      LIMITS.historyLimit.min,
      LIMITS.historyLimit.max,
    ),
    memoryCharBudget: clampInt(
      input.memoryCharBudget ?? current.memoryCharBudget,
      current.memoryCharBudget,
      LIMITS.memoryCharBudget.min,
      LIMITS.memoryCharBudget.max,
    ),
  }

  setSetting('ai.memoryLimit', String(next.memoryLimit))
  setSetting('ai.historyLimit', String(next.historyLimit))
  setSetting('ai.memoryCharBudget', String(next.memoryCharBudget))
  return next
}
