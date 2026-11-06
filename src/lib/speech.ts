/** 浏览器内置语音合成（Web Speech API）。不依赖任何内置音频文件。 */

export interface SpeakHandlers {
  onStart?: () => void
  onEnd?: () => void
  onError?: () => void
}

let cachedVoices: SpeechSynthesisVoice[] = []
let speakToken = 0
let activeHandlers: SpeakHandlers | null = null

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null
  return window.speechSynthesis
}

export function speechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  )
}

function loadVoices() {
  const engine = synth()
  if (!engine) return
  cachedVoices = engine.getVoices()
}

function pickEnglishVoice(): SpeechSynthesisVoice | null {
  if (!cachedVoices.length) loadVoices()
  const english = cachedVoices.filter((voice) => voice.lang.toLowerCase().startsWith('en'))
  const preferred =
    english.find(
      (voice) =>
        voice.localService &&
        /Samantha|Google US English|Microsoft (Aria|Jenny|Guy)|Natural/i.test(voice.name),
    ) ??
    english.find(
      (voice) => voice.localService && voice.lang.toLowerCase().replace('_', '-') === 'en-us',
    ) ??
    english.find((voice) => voice.lang.toLowerCase().replace('_', '-') === 'en-us') ??
    english[0]
  return preferred ?? null
}

function normalizeText(value: string): string {
  return value
    .replace(/[*_`#>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 长文本分块，避免 Chrome/Edge 在十几秒后截断。 */
function splitChunks(text: string, maxLength = 180): string[] {
  if (text.length <= maxLength) return [text]
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text]
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    const piece = sentence.trim()
    if (!piece) continue
    if (current && current.length + piece.length + 1 > maxLength) {
      chunks.push(current)
      current = piece
    } else {
      current = current ? `${current} ${piece}` : piece
    }
  }
  if (current) chunks.push(current)
  return chunks.length ? chunks : [text]
}

/**
 * 使用浏览器自带语音朗读英文。
 * 返回 false 表示当前浏览器不支持语音合成。
 */
export function speak(text: string, handlers: SpeakHandlers = {}): boolean {
  const engine = synth()
  const content = normalizeText(text)
  if (!engine || !content) return false

  // 切换到另一个朗读按钮时，先把上一个按钮的“正在朗读”状态复位。
  activeHandlers?.onEnd?.()
  activeHandlers = handlers

  const token = ++speakToken
  const wasActive = engine.speaking || engine.pending
  engine.cancel()

  const start = () => {
    if (token !== speakToken) return
    try {
      engine.resume()
    } catch {
      // ignore
    }

    const chunks = splitChunks(content)
    chunks.forEach((chunk, index) => {
      const utterance = new SpeechSynthesisUtterance(chunk)
      utterance.lang = 'en-US'
      utterance.rate = 0.92
      utterance.pitch = 1
      utterance.volume = 1
      const voice = pickEnglishVoice()
      if (voice) utterance.voice = voice

      if (index === 0) {
        utterance.onstart = () => {
          if (token === speakToken) handlers.onStart?.()
        }
      }
      if (index === chunks.length - 1) {
        utterance.onend = () => {
          if (token === speakToken) {
            if (activeHandlers === handlers) activeHandlers = null
            handlers.onEnd?.()
          }
        }
      }
      utterance.onerror = () => {
        if (token === speakToken) {
          if (activeHandlers === handlers) activeHandlers = null
          handlers.onError?.()
        }
      }

      try {
        engine.speak(utterance)
      } catch {
        if (token === speakToken) {
          if (activeHandlers === handlers) activeHandlers = null
          handlers.onError?.()
        }
      }
    })
  }

  // Chrome/Edge 在 cancel() 后同一帧调用 speak() 可能静默失败；只有确实在播
  // 时才延迟，避免 Safari 因为丢失用户手势而拒绝首次朗读。
  if (wasActive) {
    window.setTimeout(start, 60)
  } else {
    start()
  }

  return true
}

export function stopSpeaking(): void {
  activeHandlers?.onEnd?.()
  activeHandlers = null
  speakToken += 1
  synth()?.cancel()
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  loadVoices()
  window.speechSynthesis.onvoiceschanged = loadVoices
}
