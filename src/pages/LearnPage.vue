<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import type { Entry, LearnCompleteResult, LearnStats, TagSummary } from '@shared/types'
import AnkiImportModal from '@/components/AnkiImportModal.vue'
import EntryDetails from '@/components/EntryDetails.vue'
import Icon from '@/components/Icon.vue'
import SpeakButton from '@/components/SpeakButton.vue'
import TypeBadge from '@/components/TypeBadge.vue'
import { t } from '@/i18n'
import { api, errorMessage } from '@/lib/api'
import { useAppStore } from '@/stores/app'

type Phase = 'setup' | 'recognize' | 'study' | 'done'

const BATCH_KEY = 'easyenglish.learnBatchSize'
const TAG_KEY = 'easyenglish.learnTag'
const BATCH_OPTIONS = [5, 10, 20, 30, 50]

const router = useRouter()
const appStore = useAppStore()

const phase = ref<Phase>('setup')
const batchSize = ref(readBatchSize())
const selectedTag = ref(readSavedTag())
const tags = ref<TagSummary[]>([])
const stats = ref<LearnStats | null>(null)
const queue = ref<Entry[]>([])
const index = ref(0)
const studyIndex = ref(0)
const knownIds = ref<number[]>([])
const unknownIds = ref<number[]>([])
const result = ref<LearnCompleteResult | null>(null)
const loading = ref(false)
const submitting = ref(false)
const error = ref('')
const importOpen = ref(false)

const studyQueue = computed(() =>
  queue.value.filter((entry) => unknownIds.value.includes(entry.id)),
)
const current = computed<Entry | null>(() => {
  if (phase.value === 'recognize') return queue.value[index.value] ?? null
  if (phase.value === 'study') return studyQueue.value[studyIndex.value] ?? null
  return null
})
const totalInPhase = computed(() =>
  phase.value === 'study' ? studyQueue.value.length : queue.value.length,
)
const positionInPhase = computed(() =>
  phase.value === 'study' ? studyIndex.value + 1 : index.value + 1,
)
const progress = computed(() =>
  totalInPhase.value ? Math.round(((positionInPhase.value - 1) / totalInPhase.value) * 100) : 0,
)
const isLastInPhase = computed(() => positionInPhase.value >= totalInPhase.value)
const knownWords = computed(() => queue.value.filter((entry) => knownIds.value.includes(entry.id)))
const unknownWords = computed(() =>
  queue.value.filter((entry) => unknownIds.value.includes(entry.id)),
)

function readBatchSize(): number {
  try {
    const saved = Number(localStorage.getItem(BATCH_KEY))
    return BATCH_OPTIONS.includes(saved) ? saved : 10
  } catch {
    return 10
  }
}

function readSavedTag(): string {
  try {
    return localStorage.getItem(TAG_KEY) ?? ''
  } catch {
    return ''
  }
}

watch(batchSize, (value) => {
  try {
    localStorage.setItem(BATCH_KEY, String(value))
  } catch {
    // ignore private-mode storage errors
  }
})

watch(selectedTag, (value) => {
  try {
    if (value) localStorage.setItem(TAG_KEY, value)
    else localStorage.removeItem(TAG_KEY)
  } catch {
    // ignore private-mode storage errors
  }
  if (phase.value === 'setup') loadStats()
})

async function loadTags() {
  try {
    const data = await api.tags.list()
    tags.value = data.items
    // 之前选中的标签可能已被删除或改名。
    if (
      selectedTag.value &&
      !data.items.some((item) => item.tag === selectedTag.value)
    ) {
      selectedTag.value = ''
    }
  } catch {
    // 标签加载失败不阻塞学习，只是不显示筛选。
    tags.value = []
  }
}

async function loadStats() {
  try {
    stats.value = await api.learn.stats(selectedTag.value || undefined)
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

async function start() {
  loading.value = true
  error.value = ''
  result.value = null
  try {
    const data = await api.learn.queue(
      batchSize.value,
      undefined,
      selectedTag.value || undefined,
    )
    if (!data.items.length) {
      error.value = t('learn.noWords')
      await loadStats()
      return
    }
    queue.value = data.items
    index.value = 0
    studyIndex.value = 0
    knownIds.value = []
    unknownIds.value = []
    phase.value = 'recognize'
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

function advanceRecognition() {
  if (index.value + 1 < queue.value.length) {
    index.value += 1
    return
  }
  if (unknownIds.value.length) {
    phase.value = 'study'
    studyIndex.value = 0
  } else {
    finish()
  }
}

function markKnown() {
  const entry = current.value
  if (!entry || phase.value !== 'recognize' || loading.value) return
  knownIds.value = [...knownIds.value, entry.id]
  advanceRecognition()
}

function markUnknown() {
  const entry = current.value
  if (!entry || phase.value !== 'recognize' || loading.value) return
  unknownIds.value = [...unknownIds.value, entry.id]
  advanceRecognition()
}

function advanceStudy() {
  if (studyIndex.value + 1 < studyQueue.value.length) {
    studyIndex.value += 1
  } else {
    finish()
  }
}

async function finish() {
  if (submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    result.value = await api.learn.complete({
      known: knownIds.value,
      unknown: unknownIds.value,
    })
    phase.value = 'done'
    await loadStats()
    appStore.refreshStats().catch(() => {})
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    submitting.value = false
  }
}

function reset() {
  phase.value = 'setup'
  queue.value = []
  index.value = 0
  studyIndex.value = 0
  knownIds.value = []
  unknownIds.value = []
  result.value = null
  error.value = ''
}

function exit() {
  if (submitting.value) return
  if (
    phase.value !== 'setup' &&
    phase.value !== 'done' &&
    !window.confirm(t('learn.exitConfirm'))
  ) {
    return
  }
  reset()
  loadStats()
}

async function onImported() {
  await loadTags()
  await loadStats()
  appStore.refreshStats().catch(() => {})
}

function onKeydown(event: KeyboardEvent) {
  if (loading.value || submitting.value) return
  const key = event.key.toLowerCase()

  if (phase.value === 'recognize') {
    if (event.key === '1' || key === 'j') {
      event.preventDefault()
      markKnown()
    } else if (event.key === '2' || key === 'k') {
      event.preventDefault()
      markUnknown()
    }
  } else if (phase.value === 'study' && (event.key === ' ' || event.key === 'Enter')) {
    event.preventDefault()
    advanceStudy()
  }
}

onBeforeRouteLeave(() => {
  if (phase.value === 'recognize' || phase.value === 'study') {
    return window.confirm(t('learn.exitConfirm'))
  }
  return true
})

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  await loadTags()
  await loadStats()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>{{ t('learn.title') }}</h1>
        <p>{{ t('learn.subtitle') }}</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-ghost" @click="importOpen = true">
          <Icon name="upload" :size="16" /> {{ t('learn.importAnki') }}
        </button>
      </div>
    </header>

    <p v-if="error" class="banner banner-error">{{ error }}</p>

    <template v-if="phase === 'setup'">
      <section class="learn-stats">
        <div class="card stat-card">
          <strong>{{ stats?.unlearned ?? '—' }}</strong>
          <span>{{ t('learn.statsUnlearned') }}</span>
        </div>
        <div class="card stat-card">
          <strong>{{ stats?.learned ?? '—' }}</strong>
          <span>{{ t('learn.statsLearned') }}</span>
        </div>
        <div class="card stat-card">
          <strong>{{ stats?.total ?? '—' }}</strong>
          <span>{{ t('learn.statsTotal') }}</span>
        </div>
      </section>

      <section v-if="stats && stats.unlearned === 0" class="card empty-card">
        <div class="empty-mark"><Icon name="learn" :size="30" /></div>
        <h2>{{ selectedTag ? t('learn.tagEmpty') : t('learn.emptyTitle') }}</h2>
        <p class="muted">{{ t('learn.emptyHint') }}</p>
        <div v-if="tags.length" class="field tag-pick">
          <label for="learn-tag-empty">{{ t('learn.tagLabel') }}</label>
          <select id="learn-tag-empty" v-model="selectedTag" class="select">
            <option value="">{{ t('learn.tagAll') }}</option>
            <option v-for="item in tags" :key="item.tag" :value="item.tag">
              {{ item.tag }} · {{ t('learn.tagUnlearned', { count: item.unlearned }) }}
            </option>
          </select>
          <span class="hint">{{ t('learn.tagHint') }}</span>
        </div>
        <div class="setup-actions">
          <button class="btn btn-primary" @click="importOpen = true">
            <Icon name="upload" :size="17" /> {{ t('learn.importAnki') }}
          </button>
          <RouterLink to="/library" class="btn btn-ghost">
            <Icon name="book-open" :size="17" /> {{ t('learn.backLibrary') }}
          </RouterLink>
        </div>
      </section>

      <section v-else class="card setup-card">
        <div v-if="tags.length" class="field">
          <label for="learn-tag">{{ t('learn.tagLabel') }}</label>
          <select id="learn-tag" v-model="selectedTag" class="select">
            <option value="">{{ t('learn.tagAll') }}</option>
            <option v-for="item in tags" :key="item.tag" :value="item.tag">
              {{ item.tag }} · {{ t('learn.tagUnlearned', { count: item.unlearned }) }}
            </option>
          </select>
          <span class="hint">{{ t('learn.tagHint') }}</span>
        </div>

        <div class="field">
          <label for="learn-batch-size">{{ t('learn.batchSize') }}</label>
          <select id="learn-batch-size" v-model.number="batchSize" class="select">
            <option v-for="size in BATCH_OPTIONS" :key="size" :value="size">{{ size }}</option>
          </select>
          <span class="hint">{{ t('learn.batchSizeHint') }}</span>
        </div>

        <button class="btn btn-primary btn-lg" :disabled="loading" @click="start">
          <Icon :name="loading ? 'refresh' : 'learn'" :size="18" />
          {{ loading ? t('learn.starting') : t('learn.start') }}
        </button>
        <p v-if="stats" class="hint">{{ t('learn.remaining', { count: stats.unlearned }) }}</p>
      </section>
    </template>

    <template v-else-if="(phase === 'recognize' || phase === 'study') && current">
      <div class="learn-bar">
        <button class="btn btn-ghost btn-sm" @click="exit">
          <Icon name="chevron-left" :size="15" /> {{ t('learn.exit') }}
        </button>
        <span class="phase-label">
          {{ phase === 'recognize' ? t('learn.recognizePhase') : t('learn.studyPhase') }}
        </span>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: `${progress}%` }" />
        </div>
        <span class="muted small">
          {{ t('learn.progress', { current: positionInPhase, total: totalInPhase }) }}
        </span>
      </div>

      <section class="learn-card card">
        <div class="learn-meta">
          <TypeBadge :type="current.type" />
          <SpeakButton :text="current.text" :size="20" />
        </div>

        <p v-if="current.phonetic" class="learn-phonetic">{{ current.phonetic }}</p>
        <p class="learn-text" :class="{ sentence: current.type === 'sentence' }">
          {{ current.text }}
        </p>

        <template v-if="phase === 'recognize'">
          <p class="hint recognition-hint">{{ t('learn.recognitionHint') }}</p>
          <div class="learn-actions">
            <button class="btn btn-primary btn-lg" :disabled="submitting" @click="markKnown">
              <Icon name="check" :size="18" /> {{ t('learn.known') }}
            </button>
            <button class="btn btn-ghost btn-lg" :disabled="submitting" @click="markUnknown">
              <Icon name="refresh" :size="18" /> {{ t('learn.unknown') }}
            </button>
          </div>
          <p class="hint key-hint">1 / J · 2 / K</p>
        </template>

        <template v-else>
          <h2 class="reveal-title">{{ t('learn.revealTitle') }}</h2>
          <EntryDetails :entry="current" :show-phonetic="false" />
          <p v-if="!current.meaning && !current.englishDefinition" class="hint">
            {{ t('learn.noDetail') }}
          </p>
          <button class="btn btn-primary btn-lg" :disabled="submitting" @click="advanceStudy">
            {{ submitting ? t('common.loading') : isLastInPhase ? t('learn.finish') : t('learn.next') }}
            <Icon :name="isLastInPhase ? 'check' : 'arrow-right'" :size="18" />
          </button>
        </template>
      </section>

      <div class="learn-tally">
        <span class="ok">{{ t('learn.knownSummary') }} {{ knownIds.length }}</span>
        <span class="bad">{{ t('learn.unknownSummary') }} {{ unknownIds.length }}</span>
      </div>
    </template>

    <template v-else-if="phase === 'done'">
      <section class="card done-card">
        <div class="done-mark"><Icon name="check" :size="30" /></div>
        <h2>{{ t('learn.doneTitle') }}</h2>
        <p class="muted">
          {{ t('learn.doneSummary', { known: result?.known ?? 0, unknown: result?.unknown ?? 0 }) }}
        </p>
        <p class="banner banner-info added-note">{{ t('learn.addedToReview') }}</p>

        <div v-if="knownWords.length || unknownWords.length" class="done-lists">
          <div v-if="knownWords.length">
            <h3 class="ok">{{ t('learn.knownSummary') }}</h3>
            <div class="word-chips">
              <span v-for="entry in knownWords" :key="entry.id" class="tag">{{ entry.text }}</span>
            </div>
          </div>
          <div v-if="unknownWords.length">
            <h3 class="bad">{{ t('learn.unknownSummary') }}</h3>
            <div class="word-chips">
              <span v-for="entry in unknownWords" :key="entry.id" class="tag">{{ entry.text }}</span>
            </div>
          </div>
        </div>

        <p v-if="stats" class="muted small">
          {{ t('learn.remaining', { count: stats.unlearned }) }}
        </p>
        <div class="done-actions">
          <button class="btn btn-primary" :disabled="!stats || stats.unlearned === 0" @click="start">
            {{ t('learn.again') }}
          </button>
          <button class="btn btn-ghost" @click="router.push('/library')">
            {{ t('learn.backLibrary') }}
          </button>
          <button class="btn btn-ghost" @click="importOpen = true">
            <Icon name="upload" :size="16" /> {{ t('learn.importAnki') }}
          </button>
        </div>
      </section>
    </template>

    <AnkiImportModal :open="importOpen" @close="importOpen = false" @imported="onImported" />
  </div>
</template>

<style scoped>
.head-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.learn-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  max-width: 720px;
  margin-bottom: 18px;
}
.stat-card {
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stat-card strong {
  font-size: 26px;
  font-weight: 600;
  color: var(--ink);
}
.stat-card span {
  font-size: 12px;
  color: var(--muted);
}
.setup-card {
  max-width: 720px;
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.setup-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}
.tag-pick {
  width: 100%;
  max-width: 420px;
  text-align: left;
}
.empty-card {
  max-width: 620px;
  margin: 20px auto;
  padding: 36px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.empty-mark,
.done-mark {
  width: 64px;
  height: 64px;
  border-radius: var(--radius);
  display: grid;
  place-items: center;
  background: var(--accent-soft);
  color: var(--accent-strong);
  box-shadow: var(--shadow-inset-sm);
}
.empty-card h2 {
  margin: 6px 0 0;
  font-size: 22px;
  font-weight: 600;
}
.learn-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
}
.phase-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap;
}
.progress-track {
  flex: 1;
  height: 10px;
  border-radius: var(--radius-sm);
  background: var(--bg);
  box-shadow: var(--shadow-inset-sm);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  border-radius: var(--radius-sm);
  background: var(--accent);
  transition: width var(--transition);
}
.learn-card {
  max-width: 760px;
  margin: 0 auto;
  padding: clamp(24px, 4vw, 40px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  text-align: center;
}
.learn-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}
.learn-phonetic {
  margin: -8px 0 0;
  color: var(--muted);
  font-size: 14px;
}
.learn-text {
  margin: 0;
  font-size: clamp(34px, 6.4vw, 56px);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.learn-text.sentence {
  font-size: clamp(23px, 4.4vw, 36px);
  line-height: 1.4;
  font-weight: 500;
}
.recognition-hint {
  margin: 0;
}
.learn-actions {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  justify-content: center;
}
.key-hint {
  margin: -10px 0 0;
  font-size: 11px;
  opacity: 0.7;
}
.reveal-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
}
.learn-tally {
  display: flex;
  justify-content: center;
  gap: 22px;
  margin-top: 20px;
  font-size: 13px;
  font-weight: 600;
}
.learn-tally .ok,
.done-lists .ok {
  color: var(--success);
}
.learn-tally .bad,
.done-lists .bad {
  color: var(--warning);
}
.done-card {
  max-width: 640px;
  margin: 30px auto;
  padding: 36px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.done-card h2 {
  margin: 4px 0 0;
  font-size: 24px;
  font-weight: 600;
}
.added-note {
  width: 100%;
  text-align: left;
}
.done-lists {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
  text-align: left;
}
.done-lists h3 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
}
.word-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.done-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 8px;
}
@media (max-width: 620px) {
  .learn-stats {
    grid-template-columns: 1fr;
  }
  .learn-bar {
    flex-wrap: wrap;
  }
}
</style>
