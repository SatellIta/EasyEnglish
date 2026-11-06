/** 词条类型：单词 / 短语 / 句子 */
export type EntryType = 'word' | 'phrase' | 'sentence'

export type ReviewStatus = 'learning' | 'reviewing' | 'mastered'

export type ReviewRating = 'remembered' | 'forgot'

export interface ReviewState {
  entryId: number
  /** 已成功复习通过的阶段数，0 表示新词/学习中 */
  stage: number
  /** 当前阶段对应的间隔天数，0 表示刚加入或遗忘后重学 */
  intervalDays: number
  nextReviewAt: string
  lastReviewedAt: string | null
  lapses: number
  totalReviews: number
  status: ReviewStatus
}

export interface Entry {
  id: number
  type: EntryType
  text: string
  meaning: string | null
  explanation: string | null
  examples: string[]
  notes: string | null
  tags: string[]
  source: string
  createdAt: string
  updatedAt: string
  review?: ReviewState
}

export interface DraftEntry {
  type: EntryType
  text: string
  meaning?: string | null
  explanation?: string | null
  examples?: string[]
  notes?: string | null
  tags?: string[]
}

/** 新建 / 编辑词条的请求体 */
export interface EntryInput {
  type: EntryType
  text: string
  meaning?: string | null
  explanation?: string | null
  examples?: string[]
  notes?: string | null
  tags?: string[]
}

export interface ListResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface ReviewStats {
  due: {
    total: number
    word: number
    phrase: number
    sentence: number
  }
  reviewedToday: number
  addedToday: number
  totalEntries: number
  mastered: number
  streakDays: number
}

export interface ChatSession {
  id: number
  title: string | null
  createdAt: string
  updatedAt: string
  messageCount: number
  preview: string | null
}

export interface ChatMessage {
  id: number
  sessionId: number
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface DailySummary {
  id: number
  date: string
  content: string
  /** AI 从当天学习内容中抽取的候选词条 */
  entries: DraftEntry[]
  createdAt: string
}

export interface SummaryResult {
  date: string
  summary: string
  entries: DraftEntry[]
  saved: boolean
}

export interface AiSettings {
  baseUrl: string
  model: string
  hasApiKey: boolean
  apiKeyMasked: string | null
  configured: boolean
  /** 配置来自环境变量还是设置页 */
  source: 'settings' | 'env' | 'none'
}

export interface ApiErrorBody {
  error: string
  details?: unknown
}

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  word: '单词',
  phrase: '短语',
  sentence: '句子',
}
