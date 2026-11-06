import type {
  AiSettings,
  ChatMessage,
  ChatSession,
  DailySummary,
  DraftEntry,
  Entry,
  EntryInput,
  EntryType,
  ReviewSettings,
  ReviewState,
  ReviewStats,
  SummaryResult,
} from '@shared/types'

export class ApiError extends Error {
  status: number
  details?: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    },
  })

  if (!response.ok) {
    let message = `请求失败（${response.status}）`
    let details: unknown
    try {
      const body = await response.json()
      if (body && typeof body.error === 'string') message = body.error
      details = body?.details
    } catch {
      // ignore
    }
    throw new ApiError(message, response.status, details)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export interface EntryListParams {
  types?: EntryType[]
  q?: string
  tag?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export const api = {
  health: () => request<{ ok: boolean }>('/health'),

  entries: {
    list: (params: EntryListParams = {}) =>
      request<{ items: Entry[]; total: number; limit: number; offset: number }>(
        `/entries${toQuery({
          types: params.types?.length ? params.types.join(',') : undefined,
          q: params.q,
          tag: params.tag,
          from: params.from,
          to: params.to,
          limit: params.limit,
          offset: params.offset,
        })}`,
      ),
    get: (id: number) => request<Entry>(`/entries/${id}`),
    create: (input: EntryInput) =>
      request<Entry>('/entries', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: number, input: Partial<EntryInput>) =>
      request<Entry>(`/entries/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id: number) => request<{ ok: boolean }>(`/entries/${id}`, { method: 'DELETE' }),
    bulkCreate: (entries: EntryInput[]) =>
      request<{ entries: Entry[]; count: number }>('/entries/bulk', {
        method: 'POST',
        body: JSON.stringify({ entries }),
      }),
  },

  review: {
    queue: (types: EntryType[], limit = 100) =>
      request<{ items: Entry[]; count: number; dueAt: string }>(
        `/review/queue${toQuery({ types: types.join(','), limit })}`,
      ),
    stats: () => request<ReviewStats>('/review/stats'),
    rate: (id: number, rating: 'remembered' | 'forgot') =>
      request<{ entry: Entry; state: ReviewState | null }>(`/review/${id}/rate`, {
        method: 'POST',
        body: JSON.stringify({ rating }),
      }),
  },

  chat: {
    sessions: () => request<{ items: ChatSession[] }>('/chat/sessions'),
    createSession: (title?: string) =>
      request<ChatSession>('/chat/sessions', {
        method: 'POST',
        body: JSON.stringify(title ? { title } : {}),
      }),
    messages: (id: number) =>
      request<{ items: ChatMessage[] }>(`/chat/sessions/${id}/messages`),
    rename: (id: number, title: string) =>
      request<{ ok: boolean }>(`/chat/sessions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      }),
    removeSession: (id: number) =>
      request<{ ok: boolean }>(`/chat/sessions/${id}`, { method: 'DELETE' }),
  },

  summary: {
    today: () =>
      request<{ date: string; summary: (DailySummary & { entries: DraftEntry[] }) | null }>(
        '/summary/today',
      ),
    generate: () =>
      request<SummaryResult>('/summary/today/generate', { method: 'POST' }),
  },

  settings: {
    get: () => request<AiSettings>('/settings'),
    update: (input: {
      baseUrl?: string
      model?: string
      apiKey?: string
      clearApiKey?: boolean
    }) => request<AiSettings>('/settings', { method: 'PUT', body: JSON.stringify(input) }),
    test: (input: { baseUrl?: string; model?: string; apiKey?: string }) =>
      request<{ ok: boolean; error?: string; model?: string; reply?: string }>('/settings/test', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    review: () => request<ReviewSettings>('/settings/review'),
    updateReview: (input: ReviewSettings) =>
      request<ReviewSettings>('/settings/review', {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
  },
}

export interface StreamHandlers {
  onMeta?: (event: { sessionId: number; userMessageId: number }) => void
  onDelta?: (text: string) => void
  onDone?: (event: { sessionId: number; messageId: number; partial?: boolean }) => void
  onError?: (message: string) => void
}

/** 读取后端以 NDJSON 推送的流式回答。 */
export async function streamChat(
  body: { sessionId?: number; message: string },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    let message = `请求失败（${response.status}）`
    try {
      const payload = await response.json()
      if (payload?.error) message = payload.error
    } catch {
      // ignore
    }
    throw new ApiError(message, response.status)
  }

  if (!response.body) throw new Error('当前浏览器不支持流式响应。')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const handleLine = (line: string) => {
    const text = line.trim()
    if (!text) return
    let event: any
    try {
      event = JSON.parse(text)
    } catch {
      return
    }
    switch (event.type) {
      case 'meta':
        handlers.onMeta?.(event)
        break
      case 'delta':
        handlers.onDelta?.(String(event.content ?? ''))
        break
      case 'done':
        handlers.onDone?.(event)
        break
      case 'error':
        handlers.onError?.(String(event.error ?? '未知错误'))
        break
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      handleLine(buffer.slice(0, index))
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\n')
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) handleLine(buffer)
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
