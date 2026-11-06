<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BaseModal from '@/components/BaseModal.vue'
import Icon from '@/components/Icon.vue'
import MarkdownView from '@/components/MarkdownView.vue'
import TypeBadge from '@/components/TypeBadge.vue'
import { t } from '@/i18n'
import { useSummaryStore } from '@/stores/summary'

const store = useSummaryStore()
const selected = ref<Set<number>>(new Set())

const modalTitle = computed(() =>
  store.status === 'error' ? t('summary.job.errorTitle') : t('summary.job.title'),
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
    {{ t('summary.job.running') }}
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
    {{ store.status === 'error' ? t('summary.job.errorPill') : t('summary.job.donePill') }}
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
        {{ t('summary.job.errorHint') }}
      </p>
    </div>

    <div v-else-if="store.result" class="job-body">
      <MarkdownView :content="store.result.summary" />

      <section v-if="resultEntries.length" class="candidates">
        <div class="candidates-head">
          <div>
            <strong>{{ t('summary.job.candidates') }}</strong>
            <p class="hint">
              {{ t('summary.job.candidatesHint') }}
            </p>
          </div>
          <div class="row">
            <button class="btn btn-ghost btn-sm" type="button" @click="selectAll">
              {{ t('summary.job.selectAll') }}
            </button>
            <button class="btn btn-ghost btn-sm" type="button" @click="selectNone">
              {{ t('summary.job.selectNone') }}
            </button>
          </div>
        </div>

        <p
          v-if="resultEntries.length && duplicateCount === resultEntries.length"
          class="banner banner-info"
        >
          {{ t('summary.job.allDuplicate') }}
        </p>
        <p v-else-if="duplicateCount" class="hint duplicate-hint">
          {{ t('summary.job.duplicateHint', { count: duplicateCount }) }}
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
                  entry.sceneSuggestion.action === 'new'
                    ? t('summary.job.suggestNew')
                    : t('summary.job.suggestExisting')
                }}：{{ entry.sceneSuggestion.sceneName }}
              </span>
              <span
                v-if="entry.sceneSuggestion && entry.sceneSuggestion.action !== 'none' && !entry.duplicate"
                class="scene-accept"
                @click.stop
              >
                <input v-model="entry.sceneAccepted" type="checkbox" @click.stop />
                {{ t('summary.job.sceneAccept') }}
              </span>
              <span v-if="entry.duplicate" class="tag">{{ t('summary.job.exists') }}</span>
            </label>
          </li>
        </ul>
      </section>

      <p v-else class="empty">{{ t('summary.job.empty') }}</p>

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
        <Icon name="refresh" :size="16" /> {{ t('common.retry') }}
      </button>
      <button class="btn btn-ghost" type="button" @click="store.dismiss()">
        {{ selectedEntries.length ? t('summary.job.later') : t('common.close') }}
      </button>
      <button
        v-if="store.status === 'done' && selectedEntries.length"
        class="btn btn-primary"
        type="button"
        :disabled="store.adding"
        @click="addSelected"
      >
        <Icon :name="store.adding ? 'refresh' : 'plus'" :size="16" />
        {{ store.adding ? t('summary.job.adding') : t('summary.job.add', { count: selectedEntries.length }) }}
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
