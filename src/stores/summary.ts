import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  BulkCreateResult,
  DraftEntry,
  SceneSuggestion,
  SummaryResult,
} from '@shared/types'
import { api, errorMessage } from '@/lib/api'
import { useAppStore } from '@/stores/app'

type SummaryStatus = 'idle' | 'running' | 'done' | 'error'

/**
 * 今日总结是全局后台任务：离开今日/对话页面不会中断，
 * 完成后由 AppShell 里的 SummaryJobHost 弹出确认框。
 */
export const useSummaryStore = defineStore('summary', () => {
  const status = ref<SummaryStatus>('idle')
  const result = ref<SummaryResult | null>(null)
  const error = ref('')
  const modalOpen = ref(false)
  const adding = ref(false)
  const addNotice = ref('')
  const addNoticeKind = ref<'ok' | 'info'>('ok')
  const addError = ref('')
  const revision = ref(0)

  let runId = 0

  const running = computed(() => status.value === 'running')

  async function generate(): Promise<SummaryResult | null> {
    if (status.value === 'running') return result.value

    const id = ++runId
    status.value = 'running'
    error.value = ''
    addNotice.value = ''
    addNoticeKind.value = 'ok'
    addError.value = ''
    result.value = null
    modalOpen.value = false

    try {
      const data = await api.summary.generate()
      if (id !== runId) return null
      result.value = data
      status.value = 'done'
      modalOpen.value = true
      return data
    } catch (caught) {
      if (id !== runId) return null
      error.value = errorMessage(caught)
      status.value = 'error'
      modalOpen.value = true
      return null
    }
  }

  function dismiss() {
    modalOpen.value = false
  }

  function reopen() {
    if (result.value || error.value) modalOpen.value = true
  }

  async function resolveSceneId(
    suggestion: SceneSuggestion,
    cache: Map<string, number>,
  ): Promise<number | null> {
    if (suggestion.action === 'existing' && suggestion.sceneId) {
      return suggestion.sceneId
    }

    const name = suggestion.sceneName?.trim()
    if (!name) return null
    const key = name.toLowerCase()
    const cached = cache.get(key)
    if (cached) return cached

    const scenes = await api.scenes.list()
    const existing = scenes.items.find(
      (scene) => scene.name.trim().toLowerCase() === key,
    )
    if (existing) {
      cache.set(key, existing.id)
      return existing.id
    }

    const created = await api.scenes.create({ name })
    cache.set(key, created.id)
    return created.id
  }

  async function addEntries(entries: DraftEntry[]): Promise<BulkCreateResult | null> {
    if (!entries.length) return null
    adding.value = true
    addNotice.value = ''
    addNoticeKind.value = 'ok'
    addError.value = ''
    try {
      const response = await api.entries.bulkCreate(
        entries.map((entry) => ({
          type: entry.type,
          text: entry.text,
          meaning: entry.meaning ?? null,
          explanation: entry.explanation ?? null,
          source: 'summary',
          sourceSessionId: entry.sourceSessionId ?? null,
          sourceMessageId: entry.sourceMessageId ?? null,
        })),
      )

      if (response.count === 0) {
        addNoticeKind.value = 'info'
        addNotice.value = response.skipped
          ? `没有新增内容：这 ${response.skipped} 条词条都已经在词库中，重复词条不会再次进入复习队列。`
          : '没有新增内容。'
      } else {
        addNoticeKind.value = 'ok'
        addNotice.value = response.skipped
          ? `新增 ${response.count} 条，跳过 ${response.skipped} 条已存在词条。`
          : `新增 ${response.count} 条，并加入复习队列。`
      }

      // 把接受场景建议的新词条归入对应场景；场景失败不影响词条已入库。
      const candidates = new Map(
        entries.map((entry) => [
          `${entry.type}:${entry.text.trim().toLowerCase()}`,
          entry,
        ]),
      )
      const sceneIdsByName = new Map<string, number>()
      let sceneAdded = 0
      let sceneFailed = 0

      for (const created of response.entries) {
        const candidate = candidates.get(
          `${created.type}:${created.text.trim().toLowerCase()}`,
        )
        const suggestion = candidate?.sceneSuggestion
        if (
          !suggestion ||
          suggestion.action === 'none' ||
          candidate?.sceneAccepted === false
        ) {
          continue
        }

        try {
          const sceneId = await resolveSceneId(suggestion, sceneIdsByName)
          if (!sceneId) {
            sceneFailed += 1
            continue
          }
          await api.scenes.addEntries(sceneId, [created.id], suggestion.section)
          sceneAdded += 1
        } catch {
          sceneFailed += 1
        }
      }

      if (sceneAdded) addNotice.value += ` 已归入场景 ${sceneAdded} 条。`
      if (sceneFailed) {
        addNoticeKind.value = 'info'
        addNotice.value += ` 有 ${sceneFailed} 条场景归并失败，词条仍已入库。`
      }

      // 已提交的候选标记为已存在，避免用户重复点击；词条本身仍在总结里可回看。
      if (result.value) {
        const submitted = new Set(entries)
        result.value = {
          ...result.value,
          entries: result.value.entries.map((entry) =>
            submitted.has(entry) ? { ...entry, duplicate: true } : entry,
          ),
        }
      }

      revision.value += 1
      await useAppStore().refreshStats().catch(() => {})
      return response
    } catch (caught) {
      addError.value = errorMessage(caught)
      return null
    } finally {
      adding.value = false
    }
  }

  return {
    status,
    result,
    error,
    modalOpen,
    adding,
    addNotice,
    addNoticeKind,
    addError,
    revision,
    running,
    generate,
    dismiss,
    reopen,
    addEntries,
  }
})
