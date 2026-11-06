import type { ReviewRating, ReviewSettings, ReviewStatus } from '../../shared/types'
import {
  DEFAULT_ERROR_RATE_INTERVAL_PENALTY,
  DEFAULT_ERROR_RATE_RECENT_WEIGHT,
  DEFAULT_FORGOT_RETRY_MINUTES,
  DEFAULT_REVIEW_INTERVALS_DAYS,
  getReviewConfig,
} from './review-config'
import { addDays, addMinutes } from './time'

/**
 * 默认艾宾浩斯复习间隔（天）。实际值可在设置页的「遗忘曲线」中修改。
 * 第 n 次成功回忆后，下一次复习安排在 intervals[n - 1] 天后。
 */
export const EBBINGHAUS_INTERVALS_DAYS = DEFAULT_REVIEW_INTERVALS_DAYS

/** 默认遗忘后的重试窗口（分钟），可在设置页修改。 */
export const FORGOT_RETRY_MINUTES = DEFAULT_FORGOT_RETRY_MINUTES

export interface Schedule {
  stage: number
  intervalDays: number
  nextReviewAt: string
  status: ReviewStatus
  lapses: number
  /** 更新后的近期加权错误率 0..1 */
  errorRate: number
  /** 更新后的错误率样本数 */
  errorSamples: number
}

export function initialSchedule(now = new Date()): Schedule {
  // 新词条立即进入复习队列，方便当天就开始主动回忆。
  return {
    stage: 0,
    intervalDays: 0,
    nextReviewAt: now.toISOString(),
    status: 'learning',
    lapses: 0,
    errorRate: 0,
    errorSamples: 0,
  }
}

interface CurrentSchedule {
  stage: number
  lapses: number
  errorRate?: number
  errorSamples?: number
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 1)
}

function roundInterval(value: number): number {
  return Math.max(0.01, Math.round(value * 100) / 100)
}

/**
 * 近期加权错误率：越新的复习结果权重越高。
 * 第一次样本直接采用观测值；之后按指数平滑，权重下限为配置的 recentWeight。
 */
function nextErrorRate(
  current: CurrentSchedule,
  rating: ReviewRating,
  recentWeight: number,
): { errorRate: number; errorSamples: number } {
  const oldRate = clampUnit(current.errorRate ?? 0)
  const samples = Math.max(0, Math.round(current.errorSamples ?? 0))
  const observed = rating === 'forgot' ? 1 : 0
  const alpha = samples === 0 ? 1 : Math.max(clampUnit(recentWeight), 1 / (samples + 1))
  return {
    errorRate: clampUnit(alpha * observed + (1 - alpha) * oldRate),
    errorSamples: samples + 1,
  }
}

export function nextSchedule(
  current: CurrentSchedule,
  rating: ReviewRating,
  now = new Date(),
  config: ReviewSettings = getReviewConfig(),
): Schedule {
  const intervals = config.intervalsDays.length
    ? config.intervalsDays
    : DEFAULT_REVIEW_INTERVALS_DAYS
  const recentWeight = clampUnit(
    config.errorRateRecentWeight ?? DEFAULT_ERROR_RATE_RECENT_WEIGHT,
  )
  const penalty = clampUnit(
    config.errorRateIntervalPenalty ?? DEFAULT_ERROR_RATE_INTERVAL_PENALTY,
  )

  const { errorRate, errorSamples } = nextErrorRate(current, rating, recentWeight)

  if (rating === 'forgot') {
    return {
      stage: 0,
      intervalDays: 0,
      nextReviewAt: addMinutes(now, config.forgotRetryMinutes).toISOString(),
      status: 'learning',
      lapses: current.lapses + 1,
      errorRate,
      errorSamples,
    }
  }

  // 错误率高时压缩间隔：相当于复习阶梯前进得更慢，避免“假掌握”。
  const adjustment = Math.max(0.2, 1 - penalty * errorRate)
  const stage = current.stage + 1

  if (stage > intervals.length) {
    if (errorRate >= 0.5) {
      // 错误率高时停在最后一档，继续巩固，不直接标记为已掌握。
      const base = intervals[intervals.length - 1] ?? 30
      const intervalDays = roundInterval(base * adjustment)
      return {
        stage: intervals.length,
        intervalDays,
        nextReviewAt: addDays(now, intervalDays).toISOString(),
        status: 'reviewing',
        lapses: current.lapses,
        errorRate,
        errorSamples,
      }
    }

    const intervalDays = roundInterval(365 * adjustment)
    return {
      stage,
      intervalDays,
      nextReviewAt: addDays(now, intervalDays).toISOString(),
      status: 'mastered',
      lapses: current.lapses,
      errorRate,
      errorSamples,
    }
  }

  const intervalDays = roundInterval(intervals[stage - 1] * adjustment)
  return {
    stage,
    intervalDays,
    nextReviewAt: addDays(now, intervalDays).toISOString(),
    status: 'reviewing',
    lapses: current.lapses,
    errorRate,
    errorSamples,
  }
}
