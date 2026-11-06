import type { ReviewRating, ReviewSettings, ReviewStatus } from '../../shared/types'
import {
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
}

export function initialSchedule(now = new Date()): Schedule {
  // 新词条立即进入复习队列，方便当天就开始主动回忆。
  return {
    stage: 0,
    intervalDays: 0,
    nextReviewAt: now.toISOString(),
    status: 'learning',
    lapses: 0,
  }
}

interface CurrentSchedule {
  stage: number
  lapses: number
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

  if (rating === 'forgot') {
    return {
      stage: 0,
      intervalDays: 0,
      nextReviewAt: addMinutes(now, config.forgotRetryMinutes).toISOString(),
      status: 'learning',
      lapses: current.lapses + 1,
    }
  }

  const stage = current.stage + 1

  if (stage > intervals.length) {
    const intervalDays = 365
    return {
      stage,
      intervalDays,
      nextReviewAt: addDays(now, intervalDays).toISOString(),
      status: 'mastered',
      lapses: current.lapses,
    }
  }

  const intervalDays = intervals[stage - 1]
  return {
    stage,
    intervalDays,
    nextReviewAt: addDays(now, intervalDays).toISOString(),
    status: stage === 0 ? 'learning' : 'reviewing',
    lapses: current.lapses,
  }
}
