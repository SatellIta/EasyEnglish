import type {
  AiBehaviorSettings,
  AiPersonaSettings,
  AiSettings,
  AiTeachingSettings,
  AnkiImportOptions,
  AnkiImportPreview,
  AnkiImportResult,
  BulkCreateResult,
  BulkDeleteInput,
  BulkDeletePreview,
  BulkDeleteResult,
  ChatMessage,
  ChatSession,
  DailySummary,
  DraftEntry,
  Entry,
  EntryInput,
  EntrySort,
  EntryType,
  ExportInput,
  ExportOptions,
  ImportCommitItem,
  ImportCommitResult,
  ImportPreview,
  LearnCompleteInput,
  LearnCompleteResult,
  LearnQueue,
  LearnStats,
  LearnerError,
  LearnerErrorStatus,
  LibraryOverview,
  MarkdownSyncResult,
  MarkdownSyncSettings,
  Persona,
  PersonaInput,
  ReviewSettings,
  ReviewState,
  ReviewStats,
  Scene,
  SceneDetail,
  SceneInput,
  SceneSummary,
  SummaryResult,
  TagListResult,
} from '@shared/types'
import { localizeServerError, t } from '@/i18n'

export class ApiError extends Error {
  status: number
  details?: unknown
  code?: string

  constructor(message: string, status: number, details?: unknown, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
    this.code = code
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
    let message = t('api.requestFailed', { status: response.status })
    let details: unknown
    let code: string | undefined
    try {
      const body = await response.json()
      if (body && typeof body.error === 'string') message = body.error
      details = body?.details
      if (body && typeof body.code === 'string') code = body.code
    } catch {
      // ignore
    }
    throw new ApiError(message, response.status, details, code)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

async function requestText(path: string, options: RequestInit = {}): Promise<string> {
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

  return response.text()
}

/** multipart 上传：不要手动设置 Content-Type，让浏览器生成 boundary。 */
async function upload<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(`/api${path}`, { method: 'POST', body: form })
  if (!response.ok) {
    let message = t('api.requestFailed', { status: response.status })
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
  sort?: EntrySort
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
          sort: params.sort,
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
    bulkCreate: (
      entries: EntryInput[],
      options: { skipDuplicates?: boolean } = {},
    ) =>
      request<BulkCreateResult>('/entries/bulk', {
        method: 'POST',
        body: JSON.stringify({ entries, skipDuplicates: options.skipDuplicates }),
      }),
    previewBulkDelete: (input: BulkDeleteInput) =>
      request<BulkDeletePreview>('/entries/bulk-delete/preview', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    bulkDelete: (input: BulkDeleteInput) =>
      request<BulkDeleteResult>('/entries/bulk-delete', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    generateExamples: (id: number, count = 3) =>
      request<{
        entry: Entry
        added: number
        examples: Array<{ en: string; zh: string }>
        message?: string
      }>(`/entries/${id}/examples`, {
        method: 'POST',
        body: JSON.stringify({ count }),
      }),
  },

  tags: {
    list: () => request<TagListResult>('/tags'),
  },

  errors: {
    list: (status?: LearnerErrorStatus, limit = 20) =>
      request<{ items: LearnerError[] }>(`/errors${toQuery({ status, limit })}`),
    update: (id: number, status: LearnerErrorStatus) =>
      request<LearnerError>(`/errors/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    remove: (id: number) =>
      request<{ ok: boolean }>(`/errors/${id}`, { method: 'DELETE' }),
  },

  personas: {
    list: () => request<{ items: Persona[] }>('/personas'),
    create: (input: PersonaInput) =>
      request<Persona>('/personas', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (id: number, input: Partial<PersonaInput>) =>
      request<Persona>(`/personas/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    remove: (id: number) =>
      request<{ ok: boolean }>(`/personas/${id}`, { method: 'DELETE' }),
    reset: (id: number) =>
      request<Persona>(`/personas/${id}/reset`, { method: 'POST' }),
  },

  library: {
    overview: () => request<LibraryOverview>('/library/overview'),
    date: (
      date: string,
      params: { type?: EntryType; q?: string; limit?: number } = {},
    ) =>
      request<{ date: string; items: Entry[]; total: number; limit: number }>(
        `/library/date/${date}${toQuery({
          type: params.type,
          q: params.q,
          limit: params.limit,
        })}`,
      ),
  },

  scenes: {
    list: () => request<{ items: SceneSummary[] }>('/scenes'),
    detail: (id: number) => request<SceneDetail>(`/scenes/${id}`),
    create: (input: SceneInput) =>
      request<Scene>('/scenes', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: number, input: Partial<SceneInput>) =>
      request<Scene>(`/scenes/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id: number) => request<{ ok: boolean }>(`/scenes/${id}`, { method: 'DELETE' }),
    addEntries: (
      id: number,
      entryIds: number[],
      section?: string | null,
      subsection?: string | null,
    ) =>
      request<{ added: number; skipped: number; scene: SceneSummary }>(
        `/scenes/${id}/entries`,
        {
          method: 'POST',
          body: JSON.stringify({ entryIds, section, subsection }),
        },
      ),
    removeEntry: (id: number, entryId: number) =>
      request<{ ok: boolean }>(`/scenes/${id}/entries/${entryId}`, { method: 'DELETE' }),
    setReview: (id: number, enabled: boolean) =>
      request<{ updated: number }>(`/scenes/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      }),
  },

  imports: {
    previewMarkdown: (markdown: string, filename?: string) =>
      request<ImportPreview>('/import/markdown/preview', {
        method: 'POST',
        body: JSON.stringify({ markdown, filename }),
      }),
    commitMarkdown: (items: ImportCommitItem[], updateExisting = false) =>
      request<ImportCommitResult>('/import/markdown/commit', {
        method: 'POST',
        body: JSON.stringify({ items, updateExisting }),
      }),
    syncMarkdown: () =>
      request<MarkdownSyncResult>('/import/markdown/sync', { method: 'POST' }),
    previewAnki: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return upload<AnkiImportPreview>('/import/anki/preview', form)
    },
    commitAnki: (importId: string, options: AnkiImportOptions) =>
      request<AnkiImportResult>('/import/anki/commit', {
        method: 'POST',
        body: JSON.stringify({ importId, options }),
      }),
    cancelAnki: (importId: string) =>
      request<{ ok: boolean }>(`/import/anki/${encodeURIComponent(importId)}`, {
        method: 'DELETE',
      }),
  },

  learn: {
    stats: (tag?: string) =>
      request<LearnStats>(`/learn/stats${toQuery({ tag })}`),
    queue: (size = 10, types?: EntryType[], tag?: string) =>
      request<LearnQueue>(
        `/learn/queue${toQuery({
          size,
          types: types?.length ? types.join(',') : undefined,
          tag,
        })}`,
      ),
    complete: (input: LearnCompleteInput) =>
      request<LearnCompleteResult>('/learn/complete', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },

  exports: {
    options: () => request<ExportOptions>('/export/options'),
    markdown: (input: ExportInput) =>
      requestText('/export/markdown', {
        method: 'POST',
        body: JSON.stringify(input),
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
    createSession: (input: { title?: string; sceneId?: number } = {}) =>
      request<ChatSession>('/chat/sessions', {
        method: 'POST',
        body: JSON.stringify(input),
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
    generate: (locale: 'zh' | 'en' = 'zh') =>
      request<SummaryResult>('/summary/today/generate', {
        method: 'POST',
        body: JSON.stringify({ locale }),
      }),
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
    aiBehavior: () => request<AiBehaviorSettings>('/settings/ai-behavior'),
    updateAiBehavior: (input: Partial<AiBehaviorSettings>) =>
      request<AiBehaviorSettings>('/settings/ai-behavior', {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    aiTeaching: () => request<AiTeachingSettings>('/settings/ai-teaching'),
    updateAiTeaching: (input: AiTeachingSettings) =>
      request<AiTeachingSettings>('/settings/ai-teaching', {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    markdown: () => request<MarkdownSyncSettings>('/settings/markdown'),
    updateMarkdown: (path: string | null) =>
      request<MarkdownSyncSettings>('/settings/markdown', {
        method: 'PUT',
        body: JSON.stringify({ path }),
      }),
    aiPersona: () => request<AiPersonaSettings>('/settings/ai-persona'),
    updateAiPersona: (input: AiPersonaSettings) =>
      request<AiPersonaSettings>('/settings/ai-persona', {
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
    let message = t('api.requestFailed', { status: response.status })
    try {
      const payload = await response.json()
      if (payload?.error) message = payload.error
    } catch {
      // ignore
    }
    throw new ApiError(localizeServerError(message), response.status)
  }

  if (!response.body) throw new Error(t('api.streamUnsupported'))

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
        handlers.onError?.(localizeServerError(String(event.error ?? t('api.unknownError'))))
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
  if (error instanceof ApiError) return localizeServerError(error.message)
  if (error instanceof Error) return localizeServerError(error.message)
  return localizeServerError(String(error))
}
