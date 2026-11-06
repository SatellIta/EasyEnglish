<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BaseModal from '@/components/BaseModal.vue'
import Icon from '@/components/Icon.vue'
import MarkdownView from '@/components/MarkdownView.vue'
import TypeBadge from '@/components/TypeBadge.vue'
import { useSummaryStore } from '@/stores/summary'

const store = useSummaryStore()
const selected = ref<Set<number>>(new Set())

const modalTitle = computed(() =>
  store.status === 'error' ? '整理失败' : '今日学习整理',
)
const resultEntries = computed(() => store.result?.entries ?? [])
const selectedEntries = computed(() =>
  resultEntries.value.filter((_, index) => selected.value.has(index)),
)
const duplicateCount = computed(
  () => resultEntries.value.filter((entry) => entry.duplicate).length,
)
const hasPendingCandidates = computed(() =>
  resultEntries.value.some((entry) => !entry.duplicate),
)

watch(
  () => store.result,
  (result) => {
    selected.value = new Set(
      result
        ? result.entries
            .map((entry, index) => (entry.duplicate ? -1 : index))
            .filter((index) => index >= 0)
        : [],
    )
  },
  { immediate: true },
)

function toggle(index: number) {
  const next = new Set(selected.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  selected.value = next
}

function selectAll() {
  selected.value = new Set(resultEntries.value.map((_, index) => index))
}

function selectNone() {
  selected.value = new Set()
}

async function addSelected() {
  const result = await store.addEntries(selectedEntries.value)
  if (result) selected.value = new Set()
}
</script>

<template>
  <div v-if="store.running" class="job-pill running" role="status" aria-live="polite">
    <span class="spinner" aria-hidden="true" />
    AI 正在整理今日学习…
  </div>

  <button
    v-else-if="
      !store.modalOpen &&
      (store.status === 'error' ||
        (store.status === 'done' && hasPendingCandidates))
    "
    class="job-pill"
    type="button"
    @click="store.reopen()"
  >
    <Icon :name="store.status === 'error' ? 'info' : 'sparkles'" :size="15" />
    {{ store.status === 'error' ? '整理失败，点击查看' : '今日总结已生成，点击查看' }}
  </button>

  <BaseModal
    :open="store.modalOpen"
    :title="modalTitle"
    width="760px"
    @close="store.dismiss()"
  >
    <div v-if="store.status === 'error'" class="job-body">
      <p class="banner banner-error">{{ store.error }}</p>
      <p class="hint">
        整理请求在后台失败了。可以重试；已经生成并保存的旧总结不会受影响。
      </p>
    </div>

    <div v-else-if="store.result" class="job-body">
      <MarkdownView :content="store.result.summary" />

      <section v-if="resultEntries.length" class="candidates">
        <div class="candidates-head">
          <div>
            <strong>值得加入复习的词条</strong>
            <p class="hint">
              默认不选已存在于词库的条目；加入时会再次按类型和文本查重。
            </p>
          </div>
          <div class="row">
            <button class="btn btn-ghost btn-sm" type="button" @click="selectAll">
              全选
            </button>
            <button class="btn btn-ghost btn-sm" type="button" @click="selectNone">
              全不选
            </button>
          </div>
        </div>

        <p
          v-if="resultEntries.length && duplicateCount === resultEntries.length"
          class="banner banner-info"
        >
          这些候选词条都已经在词库中，因此没有新增内容。重复词条不会再次进入复习队列。
        </p>
        <p v-else-if="duplicateCount" class="hint duplicate-hint">
          其中 {{ duplicateCount }} 条已在词库中，默认跳过。
        </p>

        <ul class="candidate-list">
          <li v-for="(entry, index) in resultEntries" :key="index">
            <label class="candidate-row">
              <input
                type="checkbox"
                :checked="selected.has(index)"
                @change="toggle(index)"
              />
              <TypeBadge :type="entry.type" />
              <span class="candidate-main">
                <span class="candidate-text">{{ entry.text }}</span>
                <span v-if="entry.meaning" class="candidate-meaning">
                  {{ entry.meaning }}
                </span>
                <span v-if="entry.explanation" class="candidate-explain">
                  {{ entry.explanation }}
                </span>
              </span>
              <span
                v-if="entry.sceneSuggestion && entry.sceneSuggestion.action !== 'none'"
                class="tag"
              >
                {{
                  entry.sceneSuggestion.action === 'new' ? '建议新建' : '建议归入'
                }}：{{ entry.sceneSuggestion.sceneName }}
              </span>
              <span
                v-if="entry.sceneSuggestion && entry.sceneSuggestion.action !== 'none' && !entry.duplicate"
                class="scene-accept"
                @click.stop
              >
                <input v-model="entry.sceneAccepted" type="checkbox" @click.stop />
                加入场景
              </span>
              <span v-if="entry.duplicate" class="tag">已在词库</span>
            </label>
          </li>
        </ul>
      </section>

      <p v-else class="empty">这次没有抽取到需要加入词库的新词条。</p>

      <p v-if="store.addNotice" class="banner banner-ok">{{ store.addNotice }}</p>
      <p v-if="store.addError" class="banner banner-error">{{ store.addError }}</p>
    </div>

    <template #footer>
      <button
        v-if="store.status === 'error'"
        class="btn btn-primary"
        type="button"
        :disabled="store.running"
        @click="store.generate()"
      >
        <Icon name="refresh" :size="16" /> 重试
      </button>
      <button class="btn btn-ghost" type="button" @click="store.dismiss()">
        {{ selectedEntries.length ? '稍后' : '关闭' }}
      </button>
      <button
        v-if="store.status === 'done' && selectedEntries.length"
        class="btn btn-primary"
        type="button"
        :disabled="store.adding"
        @click="addSelected"
      >
        <Icon :name="store.adding ? 'refresh' : 'plus'" :size="16" />
        {{ store.adding ? '加入中…' : `加入复习（${selectedEntries.length}）` }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.job-pill {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 60;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 11px 15px;
  border: var(--border-width, 0) solid var(--border-color, transparent);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--ink-soft);
  font-size: 12.5px;
  font-weight: 600;
  box-shadow: var(--shadow-raised);
}
button.job-pill:hover {
  box-shadow: var(--shadow-hover);
  color: var(--accent-strong);
}
.job-pill.running {
  color: var(--accent-strong);
}
.spinner {
  width: 13px;
  height: 13px;
  border: 2px solid var(--accent-soft);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}
.job-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.candidates {
  padding-top: 16px;
  border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.1));
}
.candidates-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.candidates-head strong {
  font-size: 15px;
}
.candidates-head p {
  margin: 4px 0 0;
  max-width: 52ch;
}
.duplicate-hint {
  margin-top: 10px;
}
.scene-accept {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  font-size: 11.5px;
  color: var(--muted);
  cursor: pointer;
}
.scene-accept input {
  margin: 0;
}
.candidate-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 34vh;
  overflow-y: auto;
  padding-right: 4px;
}
.candidate-row {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
  cursor: pointer;
}
.candidate-row input {
  margin-top: 3px;
  flex: 0 0 auto;
}
.candidate-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.candidate-text {
  font-size: 13.5px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.candidate-meaning,
.candidate-explain {
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
@media (max-width: 560px) {
  .job-pill {
    right: 12px;
    bottom: 12px;
  }
  .candidate-list {
    max-height: 40vh;
  }
}
</style>
