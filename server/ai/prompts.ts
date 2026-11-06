import type { ChatMessage, Entry } from '../../shared/types'
import { ENTRY_TYPE_LABELS } from '../../shared/types'

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

export function formatMemory(entries: Entry[]): string {
  if (!entries.length) {
    return '（用户还没有记录词句。可以在合适的时候提醒 TA 把遇到的单词、短语或句子加入词库。）'
  }
  return entries
    .map((entry) => {
      const parts = [`[${ENTRY_TYPE_LABELS[entry.type]}] ${entry.text}`]
      if (entry.meaning) parts.push(truncate(entry.meaning, 80))
      if (entry.explanation) parts.push(truncate(entry.explanation, 100))
      if (entry.review) parts.push(`下次复习 ${entry.review.nextReviewAt.slice(0, 10)}`)
      return `- ${parts.join('｜')}`
    })
    .join('\n')
}

export function buildSystemPrompt(memory: Entry[], today: string): string {
  return `你是 EasyEnglish，一位耐心、准确、注重实际运用的英语学习助手，服务对象是以中文为母语的学习者。

## 你的任务
- 回答学习者关于英语单词、短语、句子、语法、发音、写作和表达的问题。
- 帮助学习者把零散的知识整理成可复习的卡片。
- 主动利用下方「学习者记忆」中已记录的内容做联想和复现，帮助对抗遗忘。

## 回答规则
1. 默认用中文解释，目标语言保持英文。除非用户明确要求，否则不要整段翻译。
2. 使用 Markdown。回答要紧凑：先给结论，再给必要细节，不写空洞的鼓励语。
3. 解释单词或短语时，按需包含：含义、常见搭配、2-3 个自然例句（附中文）、语域/正式程度、易混点。
4. 解释句子时，先拆结构，再讲含义和地道用法，必要时给出改写。
5. 用户用英文表达时，若出现错误，先自然回应内容，再用一小段「小修正」指出问题并说明原因。
6. 不确定时直接说明，不要编造词义、搭配或例句。
7. 当用户表示“记录下来 / 加入词库 / 帮我整理”时，用不超过 3 条的精炼卡片格式给出建议，并提示可以在「今日」页一键整理。
8. 不鼓励选择题式记忆；鼓励主动回忆、造句和在真实语境中使用。

## 学习者记忆
以下是学习者已经记录、正在按遗忘曲线复习的词句。只在相关时自然引用，不要一次性罗列：
${formatMemory(memory)}

## 当前上下文
今天是 ${today}。学习者的界面语言是中文。`
}

export const SUMMARY_SYSTEM_PROMPT = `你是英语学习内容整理助手。你的任务是把学习者今天零散的对话和词条，整理成一份可复习的今日总结，并抽取值得长期记忆的英文词条。

只输出一个 JSON 对象，不要使用 Markdown 代码块，不要输出任何额外解释。结构必须严格为：
{
  "summary": "Markdown 格式的今日总结",
  "entries": [
    { "type": "word", "text": "英文原文", "meaning": "中文含义", "explanation": "简短用法/例句/记忆点" }
  ]
}

要求：
- summary 用中文，包含：今天学了什么、重点词句、易错点、明天的复习建议。使用 Markdown 小标题和列表。
- entries 只收录今天实际出现过的、值得长期复习的英文内容，去重，最多 12 条。
- type 只能是 "word"、"phrase" 或 "sentence"。
- text 必须是英文；meaning 和 explanation 用中文。
- explanation 控制在 80 字以内，优先写搭配或一个短例句。
- 不要收录过于简单、与学习无关的内容。如果今天没有足够内容，entries 使用空数组。`

export function buildSummaryUserPrompt(input: {
  date: string
  messages: Pick<ChatMessage, 'role' | 'content'>[]
  entries: Entry[]
}): string {
  const { date, messages, entries } = input

  const entryLines = entries.length
    ? entries
        .map((entry) => {
          const parts = [`[${ENTRY_TYPE_LABELS[entry.type]}] ${entry.text}`]
          if (entry.meaning) parts.push(truncate(entry.meaning, 120))
          if (entry.explanation) parts.push(truncate(entry.explanation, 160))
          return `- ${parts.join('｜')}`
        })
        .join('\n')
    : '（今天没有新增词条）'

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

## 今天的对话记录
${conversation}

请整理今天的学习内容，并按要求输出 JSON。`
}
