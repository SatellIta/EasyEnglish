<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Entry } from '@shared/types'
import BaseModal from '@/components/BaseModal.vue'
import Icon from '@/components/Icon.vue'
import TypeBadge from '@/components/TypeBadge.vue'
import { t } from '@/i18n'
import { api, errorMessage } from '@/lib/api'
import { definitionPreview, truncate } from '@/lib/format'

const props = defineProps<{ open: boolean; sceneId: number; existingIds: number[] }>()
const emit = defineEmits<{ close: []; added: [count: number] }>()

const q = ref('')
const entries = ref<Entry[]>([])
const selected = ref<Set<number>>(new Set())
const loading = ref(false)
const saving = ref(false)
const error = ref('')
let timer: number | undefined

const available = computed(() =>
  entries.value.filter((entry) => !props.existingIds.includes(entry.id)),
)
const count = computed(() => selected.value.size)

/** 缩略释义随界面语言选择中文释义或英英释义。 */
function definitionText(entry: Entry): string {
  return definitionPreview(entry)?.text ?? ''
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await api.entries.list({
      q: q.value.trim() || undefined,
      limit: 100,
    })
    entries.value = result.items
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

function toggle(id: number) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

async function submit() {
  if (!count.value) return
  saving.value = true
  error.value = ''
  try {
    const result = await api.scenes.addEntries(props.sceneId, [...selected.value])
    emit('added', result.added)
    emit('close')
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    saving.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    q.value = ''
    entries.value = []
    selected.value = new Set()
    error.value = ''
    load()
  },
)

watch(q, () => {
  window.clearTimeout(timer)
  timer = window.setTimeout(load, 220)
})
</script>

<template>
  <BaseModal :open="open" :title="t('scene.picker.title')" width="640px" @close="emit('close')">
    <div class="picker">
      <div class="search-box">
        <Icon name="search" :size="17" />
        <input
          v-model="q"
          class="search-input"
          :aria-label="t('scene.picker.searchLabel')"
          :placeholder="t('scene.picker.searchPlaceholder')"
        />
      </div>

      <p v-if="error" class="banner banner-error">{{ error }}</p>
      <p v-if="loading && !entries.length" class="empty">{{ t('common.loading') }}</p>
      <p v-else-if="!available.length" class="empty">
        {{ q ? t('scene.picker.emptyQuery') : t('scene.picker.empty') }}
      </p>

      <div v-else class="picker-list">
        <label v-for="entry in available" :key="entry.id" class="picker-row">
          <input
            type="checkbox"
            :checked="selected.has(entry.id)"
            @change="toggle(entry.id)"
          />
          <span class="picker-main">
            <span class="row wrap picker-title">
              <TypeBadge :type="entry.type" />
              <strong>{{ entry.text }}</strong>
            </span>
            <small v-if="definitionText(entry)">{{ definitionText(entry) }}</small>
            <small v-else-if="entry.explanation">
              {{ truncate(entry.explanation, 100) }}
            </small>
          </span>
          <span v-if="!entry.reviewEnabled" class="tag">{{ t('scene.picker.notReview') }}</span>
        </label>
      </div>
      <p class="hint">{{ t('scene.picker.hint') }}</p>
    </div>

    <template #footer>
      <button class="btn btn-ghost" type="button" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button
        class="btn btn-primary"
        type="button"
        :disabled="saving || !count"
        @click="submit"
      >
        <Icon :name="saving ? 'refresh' : 'plus'" :size="16" />
        {{ saving ? t('scene.picker.adding') : t('scene.picker.add', { count }) }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.search-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border: var(--border-width, 0) solid var(--border-color, transparent);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--muted);
  box-shadow: var(--shadow-inset);
}
.search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ink);
}
.picker-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 52vh;
  overflow-y: auto;
  padding-right: 4px;
}
.picker-row {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 11px 12px;
  border-radius: var(--radius-sm);
  background: var(--bg);
  cursor: pointer;
  transition: background-color var(--transition);
}
.picker-row:hover {
  background: var(--bg-soft);
}
.picker-row input {
  margin-top: 4px;
  flex: 0 0 auto;
}
.picker-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}
.picker-title {
  gap: 8px;
}
.picker-title strong {
  font-size: 14.5px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.picker-main small {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}
</style>
