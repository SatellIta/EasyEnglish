import type { ReviewRating, ReviewStatus } from '../../shared/types'
import { addDays, addMinutes } from './time'

/**
 * 艾宾浩斯复习间隔（天）。第 n 次成功回忆后，下一次复习安排在
 * INTERVALS_DAYS[n - 1] 天后。
 */
export const EBBINGHAUS_INTERVALS_DAYS = [1, 2, 4, 7, 15, 30, 60, 120, 240]

/** 遗忘后的短暂重试间隔（分钟），当天可以快速再见到这个词条。 */
export const FORGOT_RETRY_MINUTES = 10

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

export function nextSchedule(current: CurrentSchedule, rating: ReviewRating, now = new Date()): Schedule {
  if (rating === 'forgot') {
    return {
      stage: 0,
      intervalDays: 0,
      nextReviewAt: addMinutes(now, FORGOT_RETRY_MINUTES).toISOString(),
      status: 'learning',
      lapses: current.lapses + 1,
    }
  }

  const stage = current.stage + 1

  if (stage > EBBINGHAUS_INTERVALS_DAYS.length) {
    const intervalDays = 365
    return {
      stage,
      intervalDays,
      nextReviewAt: addDays(now, intervalDays).toISOString(),
      status: 'mastered',
      lapses: current.lapses,
    }
  }

  const intervalDays = EBBINGHAUS_INTERVALS_DAYS[stage - 1]
  return {
    stage,
    intervalDays,
    nextReviewAt: addDays(now, intervalDays).toISOString(),
    status: stage === 0 ? 'learning' : 'reviewing',
    lapses: current.lapses,
  }
}
