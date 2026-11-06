import type { ReviewSettings } from '../../shared/types'
import { getSetting, setSetting } from './settings'

export const DEFAULT_REVIEW_INTERVALS_DAYS = [1, 2, 4, 7, 15, 30, 60, 120, 240]
export const DEFAULT_FORGOT_RETRY_MINUTES = 10
export const MAX_REVIEW_INTERVALS = 20
export const MAX_INTERVAL_DAYS = 3650

function normalizeIntervals(values: number[]): number[] {
  const cleaned = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.min(Math.round(value * 100) / 100, MAX_INTERVAL_DAYS))
    .sort((a, b) => a - b)

  const unique = cleaned.filter((value, index) => index === 0 || value !== cleaned[index - 1])
  return unique.slice(0, MAX_REVIEW_INTERVALS)
}

function normalizeRetryMinutes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_FORGOT_RETRY_MINUTES
  return Math.min(Math.round(value * 100) / 100, 1440)
}

/** 读取遗忘曲线配置；数据库里的值非法时回退到默认值。 */
export function getReviewConfig(): ReviewSettings {
  let intervals = DEFAULT_REVIEW_INTERVALS_DAYS
  const rawIntervals = getSetting('review.intervalsDays')
  if (rawIntervals) {
    try {
      const parsed = JSON.parse(rawIntervals)
      if (Array.isArray(parsed)) {
        const normalized = normalizeIntervals(parsed.filter((item) => typeof item === 'number'))
        if (normalized.length) intervals = normalized
      }
    } catch {
      // 使用默认值
    }
  }

  const rawRetry = Number(getSetting('review.forgotRetryMinutes') ?? DEFAULT_FORGOT_RETRY_MINUTES)
  return {
    intervalsDays: intervals,
    forgotRetryMinutes: normalizeRetryMinutes(rawRetry),
  }
}

export function saveReviewConfig(input: ReviewSettings): ReviewSettings {
  const intervals = normalizeIntervals(input.intervalsDays)
  if (!intervals.length) throw new Error('至少需要保留一个复习间隔')
  const forgotRetryMinutes = normalizeRetryMinutes(input.forgotRetryMinutes)

  setSetting('review.intervalsDays', JSON.stringify(intervals))
  setSetting('review.forgotRetryMinutes', String(forgotRetryMinutes))

  return { intervalsDays: intervals, forgotRetryMinutes }
}
