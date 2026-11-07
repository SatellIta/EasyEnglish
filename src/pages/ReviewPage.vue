<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import type { Entry, EntryType } from '@shared/types'
import Icon from '@/components/Icon.vue'
import SpeakButton from '@/components/SpeakButton.vue'
import TypeBadge from '@/components/TypeBadge.vue'
import { entryTypeLabel, t } from '@/i18n'
import { api, errorMessage } from '@/lib/api'
import { stageLabel } from '@/lib/format'
import {
  comparePronunciation,
  speechRecognitionSupported,
  startRecognition,
  type PronunciationResult,
} from '@/lib/pronunciation'
import { speak, stopSpeaking } from '@/lib/speech'
import { useAppStore } from '@/stores/app'

type Phase = 'setup' | 'session' | 'done'

const store = useAppStore()
const router = useRouter()

const phase = ref<Phase>('setup')
const selectedTypes = ref<EntryType[]>(['word', 'phrase', 'sentence'])
const queue = ref<Entry[]>([])
const index = ref(0)
const revealed = ref(false)
const remembered = ref(0)
const forgot = ref(0)
const loading = ref(false)
const error = ref('')
const retryMinutes = ref(10)
const generatingExamples = ref(false)
const exampleNotice = ref('')
const shadowing = ref(false)
const shadowingResult = ref<PronunciationResult | null>(null)
const shadowingError = ref('')
const recognitionSupported = speechRecognitionSupported()
let recognitionController: { stop: () => void } | null = null
let shadowingToken = 0

const allTypes: EntryType[] = ['word', 'phrase', 'sentence']
const current = computed(() => queue.value[index.value] ?? null)
const progress = computed(() =>
  queue.value.length ? Math.round((index.value / queue.value.length) * 100) : 0,
)

function dueCount(type: EntryType): number {
  return store.stats?.due[type] ?? 0
}

function toggleType(type: EntryType) {
  if (selectedTypes.value.includes(type)) {
    if (selectedTypes.value.length === 1) return
    selectedTypes.value = selectedTypes.value.filter((item) => item !== type)
  } else {
    selectedTypes.value = [...selectedTypes.value, type]
  }
}

async function start() {
  loading.value = true
  error.value = ''
  phase.value = 'setup'
  try {
    const result = await api.review.queue(selectedTypes.value, 200)
    queue.value = result.items
    index.value = 0
    remembered.value = 0
    forgot.value = 0
    revealed.value = false
    exampleNotice.value = ''
    resetShadowing()
    if (!queue.value.length) {
      error.value = t('review.noDue')
      return
    }
    phase.value = 'session'
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

async function rate(rating: 'remembered' | 'forgot') {
  const entry = current.value
  if (!entry || loading.value || revealed.value) return

  loading.value = true
  error.value = ''
  try {
    const result = await api.review.rate(entry.id, rating)
    if (current.value && result.entry) Object.assign(current.value, result.entry)
    if (rating === 'remembered') {
      remembered.value += 1
      advance()
    } else {
      forgot.value += 1
      revealed.value = true
    }
    store.refreshStats().catch(() => {})
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

async function generateExamples() {
  const entry = current.value
  if (!entry || generatingExamples.value) return

  generatingExamples.value = true
  error.value = ''
  exampleNotice.value = ''
  try {
    const result = await api.entries.generateExamples(entry.id, 3)
    if (current.value && result.entry) Object.assign(current.value, result.entry)
    exampleNotice.value = result.added
      ? t('review.examplesAdded', { count: result.added })
      : result.message || t('review.noExamples')
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    generatingExamples.value = false
  }
}

function resetShadowing() {
  shadowingToken += 1
  recognitionController?.stop()
  recognitionController = null
  stopSpeaking()
  shadowing.value = false
  shadowingResult.value = null
  shadowingError.value = ''
}

function stopShadowing() {
  resetShadowing()
}

function startShadowing() {
  const entry = current.value
  if (!entry || shadowing.value) return
  if (!recognitionSupported) {
    shadowingError.value = t('pronunciation.unsupported')
    return
  }

  shadowingError.value = ''
  shadowingResult.value = null
  shadowing.value = true
  const token = ++shadowingToken
  stopSpeaking()

  const begin = () => {
    if (token !== shadowingToken) return
    const controller = startRecognition({
      onError: (message) => {
        if (token !== shadowingToken) return
        shadowingError.value = message
      },
      onEnd: (transcript) => {
        if (token !== shadowingToken) return
        recognitionController = null
        shadowing.value = false
        if (transcript.trim()) {
          shadowingResult.value = comparePronunciation(entry.text, transcript)
        }
      },
    })

    if (!controller) {
      shadowing.value = false
      shadowingError.value = t('pronunciation.cannotStart')
      return
    }
    recognitionController = controller
  }

  const ok = speak(entry.text, {
    onEnd: begin,
    onError: () => {
      if (token !== shadowingToken) return
      shadowing.value = false
      shadowingError.value = t('review.speakFailed')
    },
  })
  if (!ok) {
    shadowing.value = false
    shadowingError.value = t('review.speechUnsupported')
  }
}

function advance() {
  revealed.value = false
  exampleNotice.value = ''
  resetShadowing()
  if (index.value + 1 >= queue.value.length) {
    phase.value = 'done'
  } else {
    index.value += 1
  }
}

function exit() {
  phase.value = 'setup'
  queue.value = []
  index.value = 0
  revealed.value = false
  exampleNotice.value = ''
  resetShadowing()
  store.refreshStats().catch(() => {})
}

function onKeydown(event: KeyboardEvent) {
  if (phase.value !== 'session' || loading.value) return
  const key = event.key.toLowerCase()

  if (!revealed.value) {
    if (event.key === '1' || key === 'j') {
      event.preventDefault()
      rate('remembered')
    } else if (event.key === '2' || key === 'k') {
      event.preventDefault()
      rate('forgot')
    }
  } else if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault()
    advance()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  if (!store.stats) store.refreshStats().catch(() => {})
  api.settings
    .review()
    .then((config) => {
      retryMinutes.value = config.forgotRetryMinutes
    })
    .catch(() => {})
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  resetShadowing()
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>{{ t('review.title') }}</h1>
        <p>{{ t('review.subtitle') }}</p>
      </div>
    </header>

    <p v-if="error" class="banner banner-error">{{ error }}</p>

    <template v-if="phase === 'setup'">
      <section class="card setup-card">
        <h2>{{ t('review.selectTypes') }}</h2>
        <div class="type-filters">
          <button
            v-for="type in allTypes"
            :key="type"
            class="filter-chip"
            :class="{ active: selectedTypes.includes(type) }"
            :aria-pressed="selectedTypes.includes(type)"
            @click="toggleType(type)"
          >
            <span>{{ entryTypeLabel(type) }}</span>
            <strong>{{ dueCount(type) }}</strong>
          </button>
        </div>

        <div class="setup-summary">
          <div>
            <strong>{{ store.dueTotal }}</strong>
            <span>{{ t('review.dueNow') }}</span>
          </div>
          <div>
            <strong>{{ store.stats?.reviewedToday ?? 0 }}</strong>
            <span>{{ t('review.reviewedToday') }}</span>
          </div>
          <div>
            <strong>{{ store.stats?.streakDays ?? 0 }}</strong>
            <span>{{ t('review.streak') }}</span>
          </div>
        </div>

        <button
          class="btn btn-primary btn-lg"
          :disabled="loading || !selectedTypes.length"
          @click="start"
        >
          <Icon :name="loading ? 'refresh' : 'review'" :size="18" />
          {{ loading ? t('common.loading') : t('review.start') }}
        </button>
        <p class="hint">{{ t('review.startHint') }}</p>
      </section>
    </template>

    <template v-else-if="phase === 'session' && current">
      <div class="review-bar">
        <button class="btn btn-ghost btn-sm" @click="exit">
          <Icon name="chevron-left" :size="15" /> {{ t('review.exit') }}
        </button>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: `${progress}%` }" />
        </div>
        <span class="muted small">{{ index + 1 }} / {{ queue.length }}</span>
      </div>

      <section class="review-card card" :class="{ revealed }">
        <div class="review-meta">
          <TypeBadge :type="current.type" />
          <span class="muted small">{{ stageLabel(current.review?.stage ?? 0) }}</span>
          <span v-if="current.errorRate >= 0.05" class="tag-soft">
            {{ t('review.errorRate', { rate: Math.round(current.errorRate * 100) }) }}
          </span>
          <RouterLink
            v-if="current.sourceSessionId"
            :to="`/chat/${current.sourceSessionId}`"
            class="source-link"
          >
            {{ t('review.fromChat') }}
          </RouterLink>
          <SpeakButton :text="current.text" :size="20" />
          <button
            class="icon-btn"
            :class="{ speaking: shadowing }"
            type="button"
            :title="
              !recognitionSupported
                ? t('review.shadowUnsupported')
                : shadowing
                  ? t('review.shadowStop')
                  : t('review.shadowTitle')
            "
            :aria-label="t('review.shadowTitle')"
            :aria-pressed="shadowing"
            :disabled="!recognitionSupported"
            @click="shadowing ? stopShadowing() : startShadowing()"
          >
            <Icon :name="shadowing ? 'stop' : 'mic'" :size="20" />
          </button>
        </div>

        <p class="review-text" :class="{ sentence: current.type === 'sentence' }">
          {{ current.text }}
        </p>
        <p v-if="current.phonetic" class="review-phonetic">{{ current.phonetic }}</p>

        <div v-if="shadowing || shadowingResult || shadowingError" class="shadowing-box">
          <p v-if="shadowing" class="hint">{{ t('review.shadowListening') }}</p>
          <p v-else-if="shadowingError" class="hint">{{ shadowingError }}</p>
          <template v-else-if="shadowingResult">
            <div class="row between wrap">
              <strong>{{ t('review.shadowScore', { score: shadowingResult.score }) }}</strong>
              <span class="muted small">
                {{ t('review.shadowWords', { matched: shadowingResult.matchedWords, total: shadowingResult.totalWords }) }}
              </span>
            </div>
            <p class="hint">{{ t('review.shadowHeard', { text: shadowingResult.transcript }) }}</p>
          </template>
        </div>

        <template v-if="!revealed">
          <p class="recall-prompt">{{ t('review.recallPrompt') }}</p>
          <div class="recall-actions">
            <button class="btn btn-primary btn-lg" :disabled="loading" @click="rate('remembered')">
              <Icon name="check" :size="18" /> {{ t('review.remembered') }}
            </button>
            <button class="btn btn-ghost btn-lg" :disabled="loading" @click="rate('forgot')">
              <Icon name="refresh" :size="18" /> {{ t('review.forgot') }}
            </button>
          </div>
        </template>

        <template v-else>
          <div class="reveal">
            <div v-if="current.images.length" class="reveal-block">
              <h3>{{ t('review.images') }}</h3>
              <div class="review-images">
                <img
                  v-for="src in current.images"
                  :key="src"
                  :src="src"
                  :alt="t('learn.imageAlt')"
                  loading="lazy"
                />
              </div>
            </div>
            <div v-if="current.meaning" class="reveal-block">
              <h3>{{ t('review.meaning') }}</h3>
              <p>{{ current.meaning }}</p>
            </div>
            <div v-if="current.englishDefinition" class="reveal-block">
              <h3>{{ t('review.englishDefinition') }}</h3>
              <p class="english-def">{{ current.englishDefinition }}</p>
            </div>
            <div v-if="current.explanation" class="reveal-block">
              <h3>{{ t('review.explanation') }}</h3>
              <p class="pre-wrap">{{ current.explanation }}</p>
            </div>
            <div class="reveal-block">
              <div class="row between wrap example-head">
                <h3>{{ t('review.examples') }}</h3>
                <button
                  class="btn btn-ghost btn-sm"
                  :disabled="generatingExamples"
                  @click="generateExamples"
                >
                  <Icon :name="generatingExamples ? 'refresh' : 'sparkles'" :size="14" />
                  {{ generatingExamples ? t('review.generatingExamples') : t('review.generateExamples') }}
                </button>
              </div>
              <ul v-if="current.examples.length">
                <li v-for="(example, exampleIndex) in current.examples" :key="exampleIndex">
                  {{ example }}
                </li>
              </ul>
              <p v-else class="hint">{{ t('review.noExamplesHint') }}</p>
              <p v-if="exampleNotice" class="hint example-notice">{{ exampleNotice }}</p>
            </div>
            <div v-if="current.notes" class="reveal-block">
              <h3>{{ t('review.notes') }}</h3>
              <p class="pre-wrap">{{ current.notes }}</p>
            </div>
            <div v-if="current.tags.length" class="reveal-tags">
              <span v-for="tag in current.tags" :key="tag" class="tag">{{ tag }}</span>
            </div>
          </div>

          <button class="btn btn-primary btn-lg" :disabled="loading" @click="advance">
            {{ t('review.continue') }} <Icon name="arrow-right" :size="18" />
          </button>
          <p class="hint">{{ t('review.continueHint', { minutes: retryMinutes }) }}</p>
        </template>
      </section>

      <div class="review-stats">
        <span class="ok">{{ t('review.rememberedCount', { count: remembered }) }}</span>
        <span class="bad">{{ t('review.forgotCount', { count: forgot }) }}</span>
      </div>
    </template>

    <template v-else-if="phase === 'done'">
      <section class="card done-card">
        <div class="done-mark"><Icon name="check" :size="30" /></div>
        <h2>{{ t('review.doneTitle') }}</h2>
        <p class="muted">
          {{ t('review.doneSummary', { total: queue.length, remembered, forgot }) }}
        </p>
        <div class="done-actions">
          <button class="btn btn-primary" @click="start">{{ t('review.again') }}</button>
          <button class="btn btn-ghost" @click="router.push('/today')">{{ t('review.backToday') }}</button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.setup-card {
  max-width: 720px;
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.setup-card h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.type-filters {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.filter-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--ink-soft);
  box-shadow: var(--shadow-raised-sm);
  transition: box-shadow var(--transition), color var(--transition);
}
.filter-chip:hover {
  box-shadow: var(--shadow-hover-sm);
}
.filter-chip:active {
  box-shadow: var(--shadow-pressed);
}
.filter-chip strong {
  font-size: 19px;
  font-weight: 600;
  color: var(--ink);
}
.filter-chip.active {
  box-shadow: var(--shadow-pressed);
  color: var(--accent-strong);
}
.filter-chip.active strong {
  color: var(--accent-strong);
}
.setup-summary {
  display: flex;
  gap: 34px;
  padding: 4px 0;
}
.setup-summary div {
  display: flex;
  flex-direction: column;
}
.setup-summary strong {
  font-size: 24px;
  font-weight: 600;
  color: var(--ink);
}
.setup-summary span {
  font-size: 12px;
  color: var(--muted);
}
.review-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
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
.review-card {
  max-width: 760px;
  margin: 0 auto;
  padding: clamp(24px, 4vw, 40px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  text-align: center;
}
.review-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}
.tag-soft {
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 11px;
  font-weight: 600;
}
.source-link {
  font-size: 12px;
  color: var(--accent-strong);
}
.icon-btn.speaking {
  color: var(--accent-strong);
  box-shadow: var(--shadow-pressed);
}
.shadowing-box {
  width: 100%;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: var(--bg);
  box-shadow: var(--shadow-inset-sm);
  text-align: left;
}
.shadowing-box strong {
  color: var(--accent-strong);
}
.shadowing-box .hint {
  margin: 4px 0 0;
}
.review-text {
  margin: 0;
  font-size: clamp(32px, 6vw, 52px);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.review-text.sentence {
  font-size: clamp(23px, 4.4vw, 36px);
  line-height: 1.4;
  font-weight: 500;
}
.review-phonetic {
  margin: -16px 0 0;
  color: var(--muted);
  font-size: 14px;
}
.review-images {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.review-images img {
  max-width: min(100%, 280px);
  max-height: 220px;
  object-fit: contain;
  border-radius: var(--radius-sm);
  background: var(--bg);
  box-shadow: var(--shadow-raised-sm);
}
.english-def {
  overflow-wrap: anywhere;
}
.recall-prompt {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}
.recall-actions {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  justify-content: center;
}
.reveal {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
  text-align: left;
  padding-top: 8px;
}
.example-head {
  align-items: center;
  margin-bottom: 6px;
}
.example-head h3 {
  margin-bottom: 0;
}
.example-notice {
  margin-top: 6px;
}
.reveal-block h3 {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
  color: var(--muted);
}
.reveal-block p {
  margin: 0;
  font-size: 15px;
  line-height: 1.7;
  color: var(--ink-soft);
}
.reveal-block ul {
  margin: 0;
  padding-left: 1.2em;
  font-size: 14.5px;
  line-height: 1.7;
  color: var(--ink-soft);
}
.reveal-block li + li {
  margin-top: 4px;
}
.reveal-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.review-stats {
  display: flex;
  justify-content: center;
  gap: 20px;
  margin-top: 20px;
  font-size: 13px;
  font-weight: 600;
}
.review-stats .ok {
  color: var(--success);
}
.review-stats .bad {
  color: var(--warning);
}
.done-card {
  max-width: 520px;
  margin: 40px auto;
  padding: 36px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
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
.done-card h2 {
  margin: 6px 0 0;
  font-size: 24px;
  font-weight: 600;
}
.done-card p {
  margin: 0;
}
.done-actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  flex-wrap: wrap;
  justify-content: center;
}
.pre-wrap {
  white-space: pre-wrap;
}
@media (max-width: 620px) {
  .type-filters {
    grid-template-columns: 1fr;
  }
  .setup-summary {
    gap: 22px;
  }
}
</style>
