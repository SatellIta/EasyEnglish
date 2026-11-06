import type {
  ChatMessage,
  Entry,
  ExplanationMode,
  LearnerError,
} from '../../shared/types'
import { ENTRY_TYPE_LABELS } from '../../shared/types'

export interface ScenePromptContext {
  id: number
  name: string
  description: string | null
  sections: string[]
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

const ERROR_CATEGORY_LABELS: Record<string, string> = {
  grammar: '语法',
  usage: '用法',
  spelling: '拼写',
  pronunciation: '发音',
  other: '其他',
}

export function formatLearnerErrors(errors: LearnerError[]): string {
  if (!errors.length) return '（暂无记录）'
  return errors
    .map((error) => {
      const parts = [
        `[${ERROR_CATEGORY_LABELS[error.category] ?? '其他'}] ${error.pattern}`,
      ]
      if (error.correction) parts.push(`正确：${truncate(error.correction, 80)}`)
      if (error.example) parts.push(`例：${truncate(error.example, 80)}`)
      parts.push(`出现 ${error.occurrences} 次`)
      return `- ${parts.join('｜')}`
    })
    .join('\n')
}

export function formatMemory(
  entries: Entry[],
  charBudget = 2400,
  sceneId?: number | null,
): string {
  if (!entries.length) {
    return '（用户还没有记录词句。可以在合适的时候提醒 TA 把遇到的单词、短语或句子加入词库。）'
  }

  const lines: string[] = []
  let used = 0
  for (const entry of entries) {
    const parts = [`[${ENTRY_TYPE_LABELS[entry.type]}] ${entry.text}`]
    if (sceneId && entry.sceneRefs.some((ref) => ref.sceneId === sceneId)) {
      parts.push('本场景')
    }
    if (entry.meaning) parts.push(truncate(entry.meaning, 80))
    if (entry.explanation) parts.push(truncate(entry.explanation, 100))
    if (entry.errorRate >= 0.05) {
      parts.push(`错误率 ${Math.round(entry.errorRate * 100)}%`)
    }
    if (entry.review) {
      const state =
        entry.review.status === 'mastered'
          ? '已掌握'
          : `阶段 ${entry.review.stage}`
      parts.push(`${state}｜下次 ${entry.review.nextReviewAt.slice(0, 10)}`)
    }

    const line = `- ${parts.join('｜')}`
    if (lines.length && used + line.length > charBudget) break
    lines.push(line)
    used += line.length + 1
  }
  return lines.join('\n')
}

/**
 * Prompt layers（从上到下）：
 * 1. 语言基础层（中文辅助 / 全英文，本文件负责）
 * 2. 人格 / 用户偏好层（预留，插在语言层之后）
 * 3. 任务与回答规则
 * 4. 场景练习
 * 5. 学习者记忆
 * 6. 易错模式
 * 7. 当前上下文
 *
 * 语言层只决定「用什么语言解释」，不改变人格、偏好、场景和错误注入的内容。
 */
function buildLanguageLayer(mode: ExplanationMode): string {
  if (mode === 'english') {
    return `## Layer 1 — Language mode: English only (highest priority)
You are talking to a Chinese-speaking learner, but this session is English-only.
- Write every reply entirely in English. Do not output Chinese characters, pinyin, or Chinese translations.
- Explain English with English: a concise definition in simple English, synonyms/antonyms, collocations, register, and 2-3 natural examples. Think of a learner's monolingual dictionary (Collins-style).
- If the learner writes in Chinese, reply in English and gently encourage them to try English; you may restate their question in simple English.
- Chinese glosses in the learner-memory, scene and error data are private reference only; never quote them in the reply.
- This layer only controls the explanation language. Persona, learner preferences, scene practice and error reminders still apply, but their output must also be in English.`
  }

  return `## Layer 1 — Language mode: Chinese-assisted (highest priority)
- Default to explaining in Chinese; keep the target English content in English. Do not translate whole paragraphs unless the learner asks.
- Chinese glosses in the learner memory may be used naturally in explanations.
- This layer only controls the explanation language. Persona, learner preferences, scene practice and error reminders still apply.`
}

function buildTaskLayer(): string {
  return `## 你的任务
- 回答学习者关于英语单词、短语、句子、语法、发音、写作和表达的问题。
- 帮助学习者把零散的知识整理成可复习的卡片。
- 主动利用下方「学习者记忆」中已记录的内容做联想和复现，帮助对抗遗忘。`
}

function buildSceneLayer(
  scene: ScenePromptContext | null,
  mode: ExplanationMode,
): string {
  if (!scene) return ''
  const hint =
    mode === 'english'
      ? '学习者卡住时给一句更简单的英文提示，再回到对话。'
      : '学习者卡住时给一句简短中文提示，再回到英文。'

  return `## 场景练习：${scene.name}
${scene.description ? `场景说明：${scene.description}` : ''}
${scene.sections.length ? `场景小节：${scene.sections.join(' / ')}` : ''}
标记为「本场景」的词句是本轮优先使用的素材。请扮演场景中的对话角色，用英文推进一段真实对话：
- 每轮只推进 1-2 个问题，等学习者回应，不要一次写完整段对话。
- 优先自然带出 2-3 个本场景词句，尤其是到期或错误率高的词；不要罗列词表。
- ${hint}
- 除非学习者明确要求讲解，否则以对话练习为主，不要把场景变成词表讲解。
${mode === 'english' ? '场景说明中的中文仅供你理解，不要出现在回答中。' : ''}`
}

function buildRulesLayer(mode: ExplanationMode): string {
  const correctionLabel = mode === 'english' ? 'Small correction' : '小修正'
  const exampleNote =
    mode === 'english' ? '不要附中文翻译' : '附中文'
  const cardNote =
    mode === 'english' ? '卡片内容也使用英文。' : ''

  return `## 回答规则
1. 使用 Markdown。回答要紧凑：先给结论，再给必要细节，不写空洞的鼓励语。
2. 解释单词或短语时，按需包含：含义、常见搭配、2-3 个自然例句（${exampleNote}）、语域/正式程度、易混点。
3. 解释句子时，先拆结构，再讲含义和地道用法，必要时给出改写。
4. 用户用英文表达时，若出现错误，先自然回应内容，再用一小段「${correctionLabel}」指出问题并说明原因。
5. 不确定时直接说明，不要编造词义、搭配或例句。
6. 当用户表示“记录下来 / 加入词库 / 帮我整理”时，用不超过 3 条的精炼卡片格式给出建议，并提示可以在「今日」页一键整理。${cardNote}
7. 不鼓励选择题式记忆；鼓励主动回忆、造句和在真实语境中使用。
8. 学习者记忆只在与本轮问题相关时自然引用，整轮最多主动复现 2 个到期词；不要为了用词而硬凹，也不要一次性罗列。`
}

function buildMemoryLayer(
  memory: Entry[],
  charBudget: number | undefined,
  sceneId: number | null,
  mode: ExplanationMode,
): string {
  const note =
    mode === 'english'
      ? '\n（其中的中文释义仅供你理解，不要出现在回答中。）'
      : ''
  return `## 学习者记忆
以下是学习者已经记录、正在按遗忘曲线复习的词句。错误率越高，说明这个词越容易错或忘：${note}
${formatMemory(memory, charBudget, sceneId)}`
}

function buildErrorLayer(
  errors: LearnerError[],
  mode: ExplanationMode,
): string {
  const correctionLabel = mode === 'english' ? 'Small correction' : '小修正'
  const note =
    mode === 'english'
      ? '\n（错误描述中的中文仅供你理解，不要直接输出。）'
      : ''
  return `## 学习者反复出现的错误
以下是学习者近期反复出现的错误模式。只在相关时使用：
- 如果本轮用户的英文再次出现这些模式，先用一句「${correctionLabel}」指出，再继续回答。
- 不要每轮重复纠正同一个错误，也不要在用户没有犯错时主动提起。${note}
${formatLearnerErrors(errors)}`
}

function buildContextLayer(today: string, mode: ExplanationMode): string {
  return `## 当前上下文
今天是 ${today}。学习者的界面语言是中文。${
    mode === 'english'
      ? '但本轮是 English-only 模式，整段回复必须使用英文。'
      : ''
  }`
}

export function buildSystemPrompt(
  memory: Entry[],
  today: string,
  options: {
    errors?: LearnerError[]
    memoryCharBudget?: number
    scene?: ScenePromptContext | null
    explanationMode?: ExplanationMode
  } = {},
): string {
  const mode = options.explanationMode ?? 'bilingual'
  const scene = options.scene ?? null
  const errors = options.errors ?? []

  const layers = [
    buildLanguageLayer(mode),
    buildTaskLayer(),
    buildSceneLayer(scene, mode),
    buildRulesLayer(mode),
    buildMemoryLayer(memory, options.memoryCharBudget, scene?.id ?? null, mode),
    buildErrorLayer(errors, mode),
    buildContextLayer(today, mode),
  ].filter(Boolean)

  const prompt = layers.join('\n\n')
  return mode === 'english'
    ? `${prompt}\n\n## Final reminder\nThis session is English-only. Your entire reply must be in English; do not output Chinese characters.`
    : prompt
}

export const SUMMARY_SYSTEM_PROMPT = `你是英语学习内容整理助手。你的任务是把学习者今天零散的对话和词条，整理成一份可复习的今日总结，抽取值得长期记忆的英文词条，并记录学习者反复出现的错误。

只输出一个 JSON 对象，不要使用 Markdown 代码块，不要输出任何额外解释。结构必须严格为：
{
  "summary": "Markdown 格式的今日总结",
  "entries": [
    {
      "type": "word",
      "text": "英文原文",
      "meaning": "中文含义",
      "explanation": "简短用法/例句/记忆点",
      "scene": {
        "action": "existing",
        "sceneId": 1,
        "sceneName": "咖啡店",
        "section": "点单",
        "reason": "这些词都出现在点单对话里"
      }
    }
  ],
  "errors": [
    {
      "pattern": "简短的中文错误描述",
      "category": "grammar",
      "explanation": "中文说明，为什么错",
      "correction": "正确英文",
      "example": "学习者出错时的英文原句"
    }
  ]
}

要求：
- summary 用中文，包含：今天学了什么、重点词句、易错点、明天的复习建议。使用 Markdown 小标题和列表。
- entries 只收录今天实际出现过的、值得长期复习的英文内容，去重，最多 12 条。
- type 只能是 "word"、"phrase" 或 "sentence"。
- text 必须是英文；meaning 和 explanation 用中文。
- explanation 控制在 80 字以内，优先写搭配或一个短例句。
- 不要收录过于简单、与学习无关的内容。如果今天没有足够内容，entries 使用空数组。
- errors 只记录今天对话中真实出现的、值得以后提醒的错误，最多 8 条；没有就使用空数组。
- pattern 用简短中文概括，同一类错误只出现一次；category 只能是 "grammar"、"usage"、"spelling"、"pronunciation" 或 "other"。
- correction 和 example 必须是英文；example 尽量保留学习者原句。
- scene.action 只能是 "existing"、"new" 或 "none"。
- 归入已有场景时，sceneId 必须来自下方「已有场景」列表，不要编造 ID；sceneName 与列表保持一致。
- 如果候选词条明显属于某个已有场景，用 "existing" 并填 sceneId。
- 如果多个候选词条构成一个清晰的新场景，用 "new" 并给出简短 sceneName；单个孤立词条优先用 "none"。
- scene.section 可选，用于场景内的小节；reason 用一句中文说明。`

export function buildSummaryUserPrompt(input: {
  date: string
  messages: Pick<ChatMessage, 'role' | 'content'>[]
  entries: Entry[]
  existingTexts?: string[]
  scenes?: Array<{ id: number; name: string; description: string | null }>
}): string {
  const { date, messages, entries, existingTexts = [], scenes = [] } = input

  const entryLines = entries.length
    ? entries
        .map((entry) => {
          const parts = [`[${ENTRY_TYPE_LABELS[entry.type]}] ${entry.text}`]
          if (entry.meaning) parts.push(truncate(entry.meaning, 120))
          if (entry.explanation) parts.push(truncate(entry.explanation, 160))
          if (entry.errorRate >= 0.05) parts.push(`错误率 ${Math.round(entry.errorRate * 100)}%`)
          return `- ${parts.join('｜')}`
        })
        .join('\n')
    : '（今天没有新增词条）'

  const existingLines = existingTexts.length
    ? existingTexts.slice(0, 120).map((text) => `- ${truncate(text, 120)}`).join('\n')
    : '（暂无）'

  const sceneLines = scenes.length
    ? scenes
        .map((scene) => {
          const description = scene.description ? `｜${truncate(scene.description, 80)}` : ''
          return `- id=${scene.id}｜${scene.name}${description}`
        })
        .join('\n')
    : '（暂无）'

  // 从最近的消息开始截取，控制提示词长度。
  const picked: string[] = []
  let budget = 12_000
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    const line = `${message.role === 'user' ? '学习者' : '助手'}：${truncate(message.content, 1_500)}`
    if (line.length > budget) break
    picked.push(line)
    budget -= line.length
  }
  const conversation = picked.length ? picked.reverse().join('\n\n') : '（今天没有对话记录）'

  return `日期：${date}

## 今天新增或复习的词条
${entryLines}

## 词库中已经存在的词条（不要重复推荐）
${existingLines}

## 已有场景（归入已有场景时只能使用这些 ID）
${sceneLines}

## 今天的对话记录
${conversation}

请整理今天的学习内容，并按要求输出 JSON。`
}

export const EXAMPLE_SYSTEM_PROMPT = `你是英语例句生成助手。根据给定词条和学习者的场景、易错点，生成自然、地道、难度适中的英文例句，每句附中文翻译。

只输出一个 JSON 对象，不要使用 Markdown 代码块，不要输出任何额外解释。结构必须严格为：
{
  "examples": [
    { "en": "英文例句", "zh": "中文翻译" }
  ]
}

要求：
- 生成 2-3 句，覆盖不同语境，句子长短适中。
- 如果提供了学习者场景，优先让例句与这些场景相关。
- 不要重复已有例句；不要编造不存在的搭配或词义。
- 不要输出解释、标题或多余字段。`

export function buildExampleUserPrompt(input: {
  entry: Entry
  sceneNames: string[]
  errors: LearnerError[]
}): string {
  const { entry, sceneNames, errors } = input
  const entryParts = [`[${ENTRY_TYPE_LABELS[entry.type]}] ${entry.text}`]
  if (entry.meaning) entryParts.push(truncate(entry.meaning, 120))
  if (entry.explanation) entryParts.push(truncate(entry.explanation, 160))

  const existing = entry.examples.length
    ? entry.examples.map((example) => `- ${truncate(example, 160)}`).join('\n')
    : '（暂无）'

  return `## 词条
${entryParts.join('｜')}

## 学习者场景
${sceneNames.length ? sceneNames.map((name) => `- ${name}`).join('\n') : '（暂无）'}

## 学习者近期反复出现的错误
${formatLearnerErrors(errors)}

## 已有例句（不要重复）
${existing}

请生成 2-3 个新的个性化例句，并按要求输出 JSON。`
}
