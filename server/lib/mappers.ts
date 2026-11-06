import type {
  ChatMessage,
  ChatSession,
  DailySummary,
  DraftEntry,
  Entry,
  ReviewState,
  ReviewStatus,
  Scene,
  SceneCounts,
  SceneEntry,
  SceneRef,
  SceneSummary,
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

export function parseSceneRefs(value: unknown): SceneRef[] {
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item.sceneId === 'number' && typeof item.sceneName === 'string')
      .map((item) => ({
        sceneId: item.sceneId,
        sceneName: item.sceneName,
        section: item.section ?? null,
        subsection: item.subsection ?? null,
      }))
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
    reviewEnabled: row.review_enabled !== 0,
    sceneRefs: parseSceneRefs(row.scene_refs),
    errorRate: Number(row.error_rate ?? 0),
    errorSamples: Number(row.error_samples ?? 0),
    sourceSessionId: row.source_session_id ?? null,
    sourceMessageId: row.source_message_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    review: mapReviewState(row),
  }
}

export function mapScene(row: any): Scene {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapSceneCounts(row: any): SceneCounts {
  return {
    total: Number(row.total ?? 0),
    word: Number(row.word ?? 0),
    phrase: Number(row.phrase ?? 0),
    sentence: Number(row.sentence ?? 0),
  }
}

export function mapSceneSummary(row: any): SceneSummary {
  return {
    ...mapScene(row),
    counts: mapSceneCounts(row),
  }
}

export function mapSceneEntry(row: any): SceneEntry {
  return {
    entry: mapEntry(row),
    section: row.se_section ?? null,
    subsection: row.se_subsection ?? null,
    addedAt: row.se_added_at,
    position: Number(row.se_position ?? 0),
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
