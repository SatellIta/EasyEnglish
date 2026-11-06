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

export interface SceneRef {
  sceneId: number
  sceneName: string
  section: string | null
  subsection: string | null
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
  /** 是否进入每日复习队列；场景导入的词条默认不进入 */
  reviewEnabled: boolean
  /** 该词条所属的场景（一个词条可以出现在多个场景里） */
  sceneRefs: SceneRef[]
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
  /** 预览/总结生成时，词库里或本批次内已存在同类型同文本 */
  duplicate?: boolean
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
  /** 是否进入每日复习，默认 true */
  reviewEnabled?: boolean
  /** 来源标记，默认 manual */
  source?: string
}

export interface Scene {
  id: number
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
}

export interface SceneCounts {
  total: number
  word: number
  phrase: number
  sentence: number
}

export interface SceneSummary extends Scene {
  counts: SceneCounts
}

export interface SceneEntry {
  entry: Entry
  section: string | null
  subsection: string | null
  addedAt: string
  position: number
}

export interface SceneDetail {
  scene: SceneSummary
  items: SceneEntry[]
}

export interface SceneInput {
  name: string
  description?: string | null
}

export interface LibraryDateGroup extends SceneCounts {
  /** 本地日期 YYYY-MM-DD */
  date: string
}

export interface LibraryOverview {
  dates: LibraryDateGroup[]
  types: SceneCounts
  scenes: SceneSummary[]
}

/** 导出选项：常规词条只统计未归入场景的内容 */
export interface ExportTypeCounts {
  total: number
  word: number
  phrase: number
  sentence: number
}

export interface ExportOptions {
  types: ExportTypeCounts
  scenes: SceneSummary[]
}

export interface ExportInput {
  types: EntryType[]
  sceneIds: number[]
}

/** Markdown 预览中的一条候选词条 */
export interface ImportItem {
  id: string
  type: EntryType
  text: string
  meaning: string | null
  explanation: string | null
  examples: string[]
  notes: string | null
  tags: string[]
  /** 一级标题，例如 words / collocations / sentences / Scenery */
  category: string
  /** 二三级标题路径，用于普通词条分组 */
  group: string | null
  /** 场景名；普通词条为 null */
  scene: string | null
  /** 场景内 H3 小节 */
  section: string | null
  /** 场景内加粗小标题或引导语 */
  subsection: string | null
  /** 是否进入每日复习 */
  reviewEnabled: boolean
  /** 数据库中或本批次前面已有同类型同文本 */
  duplicate: boolean
}

export interface ImportPreviewStats {
  total: number
  word: number
  phrase: number
  sentence: number
  scenes: number
  duplicates: number
}

export interface ImportPreview {
  items: ImportItem[]
  stats: ImportPreviewStats
  warnings: string[]
}

export interface ImportCommitItem {
  type: EntryType
  text: string
  meaning?: string | null
  explanation?: string | null
  examples?: string[]
  notes?: string | null
  tags?: string[]
  scene?: string | null
  section?: string | null
  subsection?: string | null
  reviewEnabled?: boolean
}

export interface ImportCommitResult {
  created: number
  skipped: number
  scenes: string[]
  entryIds: number[]
}

export interface ListResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface BulkCreateResult {
  entries: Entry[]
  count: number
  skipped: number
  duplicates: Array<{ type: EntryType; text: string }>
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

/** 遗忘曲线配置：成功复习后的间隔阶梯（天）与遗忘后的重试窗口（分钟） */
export interface ReviewSettings {
  intervalsDays: number[]
  forgotRetryMinutes: number
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
