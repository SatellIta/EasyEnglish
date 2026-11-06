export interface PronunciationResult {
  transcript: string
  score: number
  matchedWords: number
  totalWords: number
}

export interface RecognitionHandlers {
  onStart?: () => void
  onResult?: (transcript: string) => void
  onError?: (message: string) => void
  onEnd?: (transcript: string) => void
}

function words(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const dp: number[] = Array.from({ length: cols }, (_, index) => index)

  for (let i = 1; i < rows; i += 1) {
    let previous = dp[0]
    dp[0] = i
    for (let j = 1; j < cols; j += 1) {
      const temp = dp[j]
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      previous = temp
    }
  }
  return dp[cols - 1]
}

function lcsLength(a: string[], b: string[]): number {
  const dp: number[] = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i += 1) {
    let previous = 0
    for (let j = 1; j <= b.length; j += 1) {
      const temp = dp[j]
      dp[j] =
        a[i - 1] === b[j - 1]
          ? previous + 1
          : Math.max(dp[j], dp[j - 1])
      previous = temp
    }
  }
  return dp[b.length]
}

/**
 * 用词级 LCS（单词）或字符级编辑距离（单词）粗略评估跟读匹配度。
 * 浏览器识别结果不是音素级评分，只适合做练习反馈，不作为精确发音打分。
 */
export function comparePronunciation(
  target: string,
  transcript: string,
): PronunciationResult {
  const targetWords = words(target)
  const spokenWords = words(transcript)
  if (!targetWords.length) {
    return { transcript, score: 0, matchedWords: 0, totalWords: 0 }
  }

  if (targetWords.length === 1) {
    const spoken = spokenWords.join(' ')
    const maxLength = Math.max(targetWords[0].length, spoken.length, 1)
    const distance = levenshtein(targetWords[0], spoken)
    const score = Math.round(Math.max(0, 1 - distance / maxLength) * 100)
    return {
      transcript,
      score,
      matchedWords: score >= 80 ? 1 : 0,
      totalWords: 1,
    }
  }

  const matched = lcsLength(targetWords, spokenWords)
  return {
    transcript,
    score: Math.round((matched / targetWords.length) * 100),
    matchedWords: matched,
    totalWords: targetWords.length,
  }
}

export function speechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false
  const scoped = window as unknown as {
    SpeechRecognition?: new () => unknown
    webkitSpeechRecognition?: new () => unknown
  }
  return Boolean(scoped.SpeechRecognition || scoped.webkitSpeechRecognition)
}

/** 启动一次英文语音识别；返回 null 表示浏览器不支持。 */
export function startRecognition(
  handlers: RecognitionHandlers,
): { stop: () => void } | null {
  if (typeof window === 'undefined') return null
  const scoped = window as unknown as {
    SpeechRecognition?: new () => any
    webkitSpeechRecognition?: new () => any
  }
  const Recognition = scoped.SpeechRecognition ?? scoped.webkitSpeechRecognition
  if (!Recognition) return null

  const recognition = new Recognition()
  recognition.lang = 'en-US'
  recognition.interimResults = false
  recognition.maxAlternatives = 1
  recognition.continuous = false

  let transcript = ''
  recognition.onstart = () => handlers.onStart?.()
  recognition.onresult = (event: any) => {
    transcript = ''
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      transcript += event.results[i][0].transcript
    }
    transcript = transcript.trim()
    handlers.onResult?.(transcript)
  }
  recognition.onerror = (event: any) => {
    const error = event?.error
    handlers.onError?.(
      error === 'not-allowed'
        ? '没有麦克风权限，请在浏览器里允许访问麦克风。'
        : error === 'no-speech'
          ? '没有听到语音，再试一次。'
          : `语音识别失败（${error ?? '未知错误'}）。`,
    )
  }
  recognition.onend = () => handlers.onEnd?.(transcript)

  try {
    recognition.start()
  } catch {
    handlers.onError?.('无法启动语音识别。')
    return null
  }

  return {
    stop: () => {
      try {
        recognition.stop()
      } catch {
        // ignore
      }
    },
  }
}
