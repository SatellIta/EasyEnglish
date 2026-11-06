import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AiSettings, ReviewStats } from '@shared/types'
import { api } from '@/lib/api'

export const useAppStore = defineStore('app', () => {
  const stats = ref<ReviewStats | null>(null)
  const settings = ref<AiSettings | null>(null)
  const statsLoading = ref(false)

  const dueTotal = computed(() => stats.value?.due.total ?? 0)
  const totalEntries = computed(() => stats.value?.totalEntries ?? 0)

  async function refreshStats(): Promise<void> {
    statsLoading.value = true
    try {
      stats.value = await api.review.stats()
    } finally {
      statsLoading.value = false
    }
  }

  async function loadSettings(): Promise<void> {
    settings.value = await api.settings.get()
  }

  return {
    stats,
    settings,
    statsLoading,
    dueTotal,
    totalEntries,
    refreshStats,
    loadSettings,
  }
})
