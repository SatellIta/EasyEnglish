/** 词条类型：单词 / 短语 / 句子 */
export type EntryType = 'word' | 'phrase' | 'sentence'

export type ReviewStatus = 'learning' | 'reviewing' | 'mastered'

export type ReviewRating = 'remembered' | 'forgot'

/** 学习者反复出现的错误类型 */
export type ErrorCategory = 'grammar' | 'usage' | 'spelling' | 'pronunciation' | 'other'

export type LearnerErrorStatus = 'active' | 'resolved' | 'ignored'

export interface LearnerError {
  id: number
  /** 归一化后的简短错误描述，用于去重 */
  pattern: string
  category: ErrorCategory
  explanation: string | null
  /** 正确写法 */
  correction: string | null
  /** 出错时的原始例句 */
  example: string | null
  occurrences: number
  firstSeenAt: string
  lastSeenAt: string
  status: LearnerErrorStatus
}

/** AI 总结时抽取的错误草稿，尚未入库 */
export interface LearnerErrorDraft {
  pattern: string
  category?: ErrorCategory
  explanation?: string | null
  correction?: string | null
  example?: string | null
}

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
  /** 近期加权错误率 0..1；越高表示越容易错/忘，复习间隔会被压缩 */
  errorRate: number
  /** 参与错误率计算的复习样本数 */
  errorSamples: number
  /** 来源对话，便于回到当时语境 */
  sourceSessionId: number | null
  sourceMessageId: number | null
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
  /** 已存在词条的 ID，便于 UI 跳转或说明 */
  existingEntryId?: number | null
  /** 服务端根据当天对话匹配出的来源，前端只读 */
  sourceSessionId?: number | null
  sourceMessageId?: number | null
  /** AI 建议归入的场景；服务端已校验 ID 合法性 */
  sceneSuggestion?: SceneSuggestion | null
  /** 用户是否接受场景建议，默认 true */
  sceneAccepted?: boolean
}

export interface SceneSuggestion {
  action: 'existing' | 'new' | 'none'
  sceneId: number | null
  sceneName: string | null
  section: string | null
  reason: string | null
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
  /** 来源对话 / 消息，用于词条溯源 */
  sourceSessionId?: number | null
  sourceMessageId?: number | null
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
  duplicates: Array<{ type: EntryType; text: string; existingEntryId?: number | null }>
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
  /** 错误率指数平滑的近期权重：越大越看重最近一次复习结果 */
  errorRateRecentWeight: number
  /** 错误率对间隔的惩罚：间隔 = 基础间隔 × (1 - 错误率 × 惩罚系数) */
  errorRateIntervalPenalty: number
}

/** AI 每次对话注入的上下文预算 */
export interface AiBehaviorSettings {
  /** 最多注入多少条学习者记忆 */
  memoryLimit: number
  /** 最多携带多少条历史消息 */
  historyLimit: number
  /** 学习者记忆部分的最大字符数 */
  memoryCharBudget: number
}

/** 解释语言：中文辅助 / 全英文（英译英） */
export type ExplanationMode = 'bilingual' | 'english'

export interface AiTeachingSettings {
  explanationMode: ExplanationMode
}

export interface ChatSession {
  id: number
  title: string | null
  /** 绑定的场景；场景练习会话有值 */
  sceneId: number | null
  sceneName: string | null
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
  /** 本次总结抽取并入库的反复错误 */
  errors: LearnerError[]
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

export const ERROR_CATEGORY_LABELS: Record<ErrorCategory, string> = {
  grammar: '语法',
  usage: '用法',
  spelling: '拼写',
  pronunciation: '发音',
  other: '其他',
}
