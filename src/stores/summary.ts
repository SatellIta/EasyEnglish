import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { BulkCreateResult, DraftEntry, SummaryResult } from '@shared/types'
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
