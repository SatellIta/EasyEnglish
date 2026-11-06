import type { ChatMessage, Entry, LearnerError } from '../../shared/types'
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

export function buildSystemPrompt(
  memory: Entry[],
  today: string,
  options: {
    errors?: LearnerError[]
    memoryCharBudget?: number
    scene?: ScenePromptContext | null
  } = {},
): string {
  const errors = options.errors ?? []
  const scene = options.scene ?? null
  const sceneSection = scene
    ? `
## 场景练习：${scene.name}
${scene.description ? `场景说明：${scene.description}` : ''}
${scene.sections.length ? `场景小节：${scene.sections.join(' / ')}` : ''}
标记为「本场景」的词句是本轮优先使用的素材。请扮演场景中的对话角色，用英文推进一段真实对话：
- 每轮只推进 1-2 个问题，等学习者回应，不要一次写完整段对话。
- 优先自然带出 2-3 个本场景词句，尤其是到期或错误率高的词；不要罗列词表。
- 学习者卡住时给一句简短中文提示，再回到英文。
- 除非学习者明确要求讲解，否则以对话练习为主，不要把场景变成词表讲解。
`
    : ''

  return `你是 EasyEnglish，一位耐心、准确、注重实际运用的英语学习助手，服务对象是以中文为母语的学习者。

## 你的任务
- 回答学习者关于英语单词、短语、句子、语法、发音、写作和表达的问题。
- 帮助学习者把零散的知识整理成可复习的卡片。
- 主动利用下方「学习者记忆」中已记录的内容做联想和复现，帮助对抗遗忘。
${sceneSection}
## 回答规则
1. 默认用中文解释，目标语言保持英文。除非用户明确要求，否则不要整段翻译。
2. 使用 Markdown。回答要紧凑：先给结论，再给必要细节，不写空洞的鼓励语。
3. 解释单词或短语时，按需包含：含义、常见搭配、2-3 个自然例句（附中文）、语域/正式程度、易混点。
4. 解释句子时，先拆结构，再讲含义和地道用法，必要时给出改写。
5. 用户用英文表达时，若出现错误，先自然回应内容，再用一小段「小修正」指出问题并说明原因。
6. 不确定时直接说明，不要编造词义、搭配或例句。
7. 当用户表示“记录下来 / 加入词库 / 帮我整理”时，用不超过 3 条的精炼卡片格式给出建议，并提示可以在「今日」页一键整理。
8. 不鼓励选择题式记忆；鼓励主动回忆、造句和在真实语境中使用。
9. 学习者记忆只在与本轮问题相关时自然引用，整轮最多主动复现 2 个到期词；不要为了用词而硬凹，也不要一次性罗列。

## 学习者记忆
以下是学习者已经记录、正在按遗忘曲线复习的词句。错误率越高，说明这个词越容易错或忘：
${formatMemory(memory, options.memoryCharBudget, scene?.id)}

## 学习者反复出现的错误
以下是学习者近期反复出现的错误模式。只在相关时使用：
- 如果本轮用户的英文再次出现这些模式，先用一句「小修正」指出，再继续回答。
- 不要每轮重复纠正同一个错误，也不要在用户没有犯错时主动提起。
${formatLearnerErrors(errors)}

## 当前上下文
今天是 ${today}。学习者的界面语言是中文。`
}

export const SUMMARY_SYSTEM_PROMPT = `你是英语学习内容整理助手。你的任务是把学习者今天零散的对话和词条，整理成一份可复习的今日总结，抽取值得长期记忆的英文词条，并记录学习者反复出现的错误。

只输出一个 JSON 对象，不要使用 Markdown 代码块，不要输出任何额外解释。结构必须严格为：
{
  "summary": "Markdown 格式的今日总结",
  "entries": [
    { "type": "word", "text": "英文原文", "meaning": "中文含义", "explanation": "简短用法/例句/记忆点" }
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
- correction 和 example 必须是英文；example 尽量保留学习者原句。`

export function buildSummaryUserPrompt(input: {
  date: string
  messages: Pick<ChatMessage, 'role' | 'content'>[]
  entries: Entry[]
  existingTexts?: string[]
}): string {
  const { date, messages, entries, existingTexts = [] } = input

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
