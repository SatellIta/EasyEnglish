import type {
  ChatMessage,
  ChatSession,
  DailySummary,
  DraftEntry,
  Entry,
  ReviewState,
  ReviewStatus,
} from '../../shared/types'

export function parseStringArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function mapReviewState(row: any): ReviewState | undefined {
  if (row.r_stage === null || row.r_stage === undefined) return undefined
  return {
    entryId: row.id,
    stage: row.r_stage,
    intervalDays: row.r_interval_days,
    nextReviewAt: row.r_next_review_at,
    lastReviewedAt: row.r_last_reviewed_at ?? null,
    lapses: row.r_lapses,
    totalReviews: row.r_total_reviews,
    status: row.r_status as ReviewStatus,
  }
}

export function mapEntry(row: any): Entry {
  return {
    id: row.id,
    type: row.type,
    text: row.text,
    meaning: row.meaning ?? null,
    explanation: row.explanation ?? null,
    examples: parseStringArray(row.examples),
    notes: row.notes ?? null,
    tags: parseStringArray(row.tags),
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    review: mapReviewState(row),
  }
}

export function mapChatSession(row: any): ChatSession {
  return {
    id: row.id,
    title: row.title ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: Number(row.message_count ?? 0),
    preview: row.preview ?? null,
  }
}

export function mapChatMessage(row: any): ChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  }
}

export function mapDailySummary(row: any): DailySummary & { entries: DraftEntry[] } {
  let entries: DraftEntry[] = []
  try {
    const parsed = JSON.parse(row.entries ?? '[]')
    if (Array.isArray(parsed)) entries = parsed
  } catch {
    entries = []
  }
  return {
    id: row.id,
    date: row.date,
    content: row.content,
    entries,
    createdAt: row.created_at,
  }
}
